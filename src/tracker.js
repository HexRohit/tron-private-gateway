const { MongoClient } = require('mongodb');
const TronWeb = require('tronweb');
const axios = require('axios');
const config = require('./config');

let tronWeb;
let db;

async function initialize(uri) {
 const tronWebOptions = {
  fullNode: config.tronFullNode,
  solidityNode: config.tronSolidityNode,
  eventServer: config.tronEventServer,
};

if (config.tronGridApiKey) {
  tronWebOptions.headers = { 'TRON-PRO-API-KEY': config.tronGridApiKey };
}

 tronWeb = new TronWeb(tronWebOptions);
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('tron Connected to MongoDB');
    db = client.db(config.mongoDbName);

    await getTransactions();
  } catch (err) {
    console.error(err);
  }
}

async function getTransactions() {
  try {
    const blockNumber = await db.collection('metadata').findOne().then(config => config?.tronblockNumber);
    const currentBlock = await tronWeb.trx.getCurrentBlock();
 const currentBlockNumber = currentBlock.block_header.raw_data.number;
 if (!blockNumber) {
  await db.collection('metadata').updateOne({}, { $set: { tronblockNumber: currentBlockNumber } }, { upsert: true });
  restart();
  return;
}
 const block = await tronWeb.trx.getBlockByNumber(blockNumber);
    if (currentBlockNumber - blockNumber >= 800) {
      await db.collection('metadata').updateOne({}, { $set: { tronblockNumber: currentBlockNumber } });
      const lastSavedBlockNumber = blockNumber;
      const newBlockNumber = currentBlockNumber;    
      await db.collection('skippedBlocks').insertOne({ from: lastSavedBlockNumber, to: newBlockNumber,network:"tron" });
   
      setTimeout(restart, 0);
      console.log("data set");
      return;
    }

    if (blockNumber+1 >= currentBlockNumber) {
      setTimeout(restart, 1500);
       return;
    }

    if (block.transactions === undefined || block.transactions.length === 0) {
      const updateBlockNumber = blockNumber + 1;
      await db.collection('metadata').updateOne({}, { $set: { tronblockNumber: updateBlockNumber } });
      console.log("block not found");
      setTimeout(restart, 0);
      return;
    }

    const transactions = [];
for (const tx of block.transactions) {
  const contract = tx.raw_data.contract[0];
    if (contract.type === 'TriggerSmartContract' && contract.parameter.value.data && contract.parameter.value.data.startsWith("a9059cbb") && tx.ret[0].contractRet === 'SUCCESS' ) {
    try {
      const input = '0x'+tx.raw_data.contract[0].parameter.value.data.slice(2)
      const fromAddress = tronWeb.address.fromHex(tx.raw_data.contract[0].parameter.value.owner_address);
      const amount = parseInt(tx.raw_data.contract[0].parameter.value.data.slice(2).slice(72), 16) 
      const contract = TronWeb.address.fromHex(tx.raw_data.contract[0].parameter.value.contract_address);
      const recipient = TronWeb.address.fromHex('0x'+input.slice(32, 72));
      if (amount !== '0') {
        transactions.push({
          txId: tx.txID,
         from_address: fromAddress,
         to_address: recipient,
         contract_address: contract,
         isToken:true,decimal:0,
         blockNumber: blockNumber,
         amount: amount
     });}
    } catch (error) {
      console.log(`error: ${error?.message} skipping transaction: ${tx.txID}`);
      continue;
    }
  }else{
  const contract = tx.raw_data.contract[0];
  if (contract.type === 'TransferContract' && contract.parameter.value.amount >= 0) {
    try{
    transactions.push({
      txId: tx.txID,
      amount: contract.parameter.value.amount ,
      from_address: tronWeb.address.fromHex(contract.parameter.value.owner_address),
      to_address: tronWeb.address.fromHex(contract.parameter.value.to_address),
      contract_address: null,
         isToken:false,decimal:0,
         blockNumber: blockNumber,
    });
  } catch (error) {
    console.log(`Error converting hex string to number in transaction ${tx.txID}. Skipping transaction...`);
    continue;
  }
}
}}
    if (transactions === undefined || transactions.length === 0) {
      const updateBlockNumber = blockNumber + 1;
      await db.collection('metadata').updateOne({}, { $set: { tronblockNumber: updateBlockNumber } });
      console.log("block not found");
      setTimeout(restart, 0);
      return;
    }
    await getMatchedTx(transactions, blockNumber,currentBlockNumber,block.block_header.raw_data.timestamp);
  } catch (error) {
    console.log(error);
    setTimeout(restart, 0);
  }
}

async function restart() {
  await getTransactions();
}

async function checkTransactions(addresses, transactions) {
  const addressesMap = new Map(addresses.map(address => [address.address, address]));
  const matchingTransactions = transactions.filter(tx => {
    const address = addressesMap.get(tx.to_address);
    return address != null;
  }).map(tx => {
    const address = addressesMap.get(tx.to_address);

    return {
      ...tx,
      ipnUrl: address.ipnUrl,
      apiKey:address.apiKey,
    };
  });
  return matchingTransactions;
}
async function saveContractInfo(contractAddress) {
  const tronContractsCollection = db.collection('tronContracts');
  const existingContract = await tronContractsCollection.findOne({ address: contractAddress });

  if (!existingContract) {
    const contractInfo = await fetchContractInfo(contractAddress);
    const contractData = {
      address: contractAddress,
      decimal: contractInfo.decimal,
      symbol: contractInfo.symbol,
      name: contractInfo.name,
    };

    await tronContractsCollection.insertOne(contractData);

    return contractData;
  } else {
    return existingContract;
  }
}

async function fetchContractInfo(contractAddress) {
const tweb = new TronWeb({
 fullNode: config.tronFullNode,
  solidityNode: config.tronSolidityNode,
  eventServer: config.tronEventServer,
  headers: config.tronGridApiKey ? { "TRON-PRO-API-KEY": config.tronGridApiKey } : undefined,
  privateKey: config.tronContractInfoPrivateKey,
});
const contract = await tweb.contract().at(contractAddress);
const [symbol, name, decimalhex] = await Promise.all([
  contract.symbol().call(),
  contract.name().call(),
  contract.decimals().call(),
]);
let decimal = parseInt(decimalhex)
return {
  symbol,
  name,
  decimal,
};
}
async function getMatchedTx(transactions, blockNumber,currentBlockNumber,timestampInMilliseconds) {
  const addresses = await db.collection('TRON_ADDRESS').find().toArray();
  const tronContracts = await db.collection('tronContracts').find().toArray();;
  const data = await checkTransactions(addresses, transactions);
  if (data.length > 0) {
  console.log(`tron Found ${data.length} matching transactions in block ${blockNumber}`);
  }
  for (const tx of data) {
    const contract = tx.isToken?tronContracts.find(contract => contract.address === tx.contract_address):null
    const payload = {
      txId: tx.txId,
      amount: tx.isToken
      ? tx.amount / 10 ** (contract?.decimal ||
        (await saveContractInfo(tx.contract_address)).decimal
      )
      : tx.amount / 1000000,
      fromAddress: tx.from_address,
      toAddress: tx.to_address,
      blockNumber: blockNumber,
      contractInfo: tx.isToken
      ? contract
        ? [{ ...contract, _id: undefined }]
        : [(await saveContractInfo(tx.contract_address))]
      : null,
      isToken: tx.isToken,
      confirmations:parseFloat(currentBlockNumber)-blockNumber,
      timestamp: tx.timestampInMillisecseconds,
      Time:new Date(timestampInMilliseconds).toUTCString(),
    };

    try {
         await db.collection('history').insertOne({apikey:tx.apiKey,payload, status: "Pending",ipnUrl: tx.ipnUrl,network:"trx"});;
     
      
    } catch (error) {
      console.error(`Failed to send IPN for transaction ${tx.txId}: ${error}`);
    }
  }

  let tronblockNumber = blockNumber + 1;
  await db.collection('metadata').updateOne({}, { $set: { tronblockNumber ,TronCurrentBock:currentBlockNumber} }, { upsert: true });
  getTransactions();
}

async function sendData(url, data) {
  try {
    await axios({
      method: "POST",
      url: url,
      data: data,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error(error);
  }
}

module.exports = {
  initialize,
};

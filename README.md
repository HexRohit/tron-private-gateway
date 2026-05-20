# tron-private-payment-gateway

Node.js API for TRON payments. It can generate API keys, generate TRON deposit addresses, send TRX/TRC20 transfers, track incoming TRON transactions, store matching deposits in MongoDB, and send IPN callbacks.

## Setup

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Edit `.env` with your MongoDB, TRON, and deployment values. The app loads `.env` automatically, and any environment variables already set by your host override the file.

Start with PM2:

```bash
npm start
```

For a direct local run:

```bash
node src/index.js
```

## Environment Variables

`PORT`: HTTP port for the Express server. Default: `8888`.

`MONGODB_URI`: MongoDB connection string. Required.

`MONGODB_DB_NAME`: MongoDB database name. Default: `Cluster0`.

`TRON_PRO_API_KEY`: Optional TronGrid API key used for TRON node requests.

`TRON_FULL_NODE`: TRON full node URL. Default: `https://api.trongrid.io`.

`TRON_SOLIDITY_NODE`: TRON solidity node URL. Default: `https://api.trongrid.io`.

`TRON_EVENT_SERVER`: TRON event server URL. Default: `https://api.trongrid.io`.

`TRON_RPC_FULL_HOST`: RPC host used when sending transfers. Default: `https://rpc.ankr.com/http/tron`.

`TRON_CONTRACT_INFO_PRIVATE_KEY`: Private key used by the contract metadata lookup client. Keep this out of git.

`SELF_PING_URL`: Optional URL the app calls on an interval. Leave empty to disable.

`SELF_PING_INTERVAL_MS`: Self-ping interval in milliseconds. Default: `30000`.

## API Overview

`GET /docs`: Swagger UI.

`GET /GetApiKey`: Generates and stores a new API key.

`GET /GenerateAddress?apikey=...&ipnUrl=...`: Generates a TRON address and stores the callback URL.

`GET /blocknumber`: Returns tracker block state.

`POST /tron/Transfer`: Sends TRX. Body: `receiver`, `amount`, `private_key`, `apikey`.

`POST /trc20/Transfer`: Sends TRC20 tokens. Body: `receiver`, `amount`, `private_key`, `apikey`, `contractAddress`.

`GET /history?apiKey=...&address=...`: Searches stored history.

## Security Notes

Do not commit `.env`. This repo ignores `.env` and `.env.*`, except `.env.example`.

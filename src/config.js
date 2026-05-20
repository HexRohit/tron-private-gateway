const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalized.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getEnv(name, options = {}) {
  const value = process.env[name];

  if ((value === undefined || value === '') && options.required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value || options.defaultValue;
}

function getNumberEnv(name, defaultValue) {
  const value = getEnv(name, { defaultValue: String(defaultValue) });
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error(`Environment variable ${name} must be a valid number`);
  }

  return number;
}

loadEnvFile();

module.exports = {
  port: getNumberEnv('PORT', 8888),
  mongoUri: getEnv('MONGODB_URI', { required: true }),
  mongoDbName: getEnv('MONGODB_DB_NAME', { defaultValue: 'Cluster0' }),
  tronGridApiKey: getEnv('TRON_PRO_API_KEY'),
  tronFullNode: getEnv('TRON_FULL_NODE', { defaultValue: 'https://api.trongrid.io' }),
  tronSolidityNode: getEnv('TRON_SOLIDITY_NODE', { defaultValue: 'https://api.trongrid.io' }),
  tronEventServer: getEnv('TRON_EVENT_SERVER', { defaultValue: 'https://api.trongrid.io' }),
  tronRpcFullHost: getEnv('TRON_RPC_FULL_HOST', { defaultValue: 'https://rpc.ankr.com/http/tron' }),
  tronContractInfoPrivateKey: getEnv('TRON_CONTRACT_INFO_PRIVATE_KEY'),
  selfPingUrl: getEnv('SELF_PING_URL'),
  selfPingIntervalMs: getNumberEnv('SELF_PING_INTERVAL_MS', 30000),
};

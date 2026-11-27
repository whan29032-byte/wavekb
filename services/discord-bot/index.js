'use strict';

const path = require('node:path');
const { loadConfig } = require('./config');
const { createDatabase } = require('./database');
const { configureProxy } = require('./network');

function prepareRuntime(
  config,
  {
    networkFactory = configureProxy,
    botLoader = () => require('./bot')
  } = {}
) {
  const network = networkFactory(config.proxyUrl);
  const botRuntime = botLoader();
  return { network, ...botRuntime };
}

async function main() {
  require('dotenv').config();
  const config = loadConfig(process.env, __dirname);
  const { network, createBot, shutdownBot } = prepareRuntime(config);
  const { loadCommands } = require('./command-loader');
  const database = createDatabase(config.databasePath);
  const { collection } = loadCommands(path.resolve(__dirname, 'commands'));
  const client = createBot({
    config,
    database,
    commands: collection,
    networkFactory: () => network
  });
  let shuttingDown = false;

  const shutdown = signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`收到 ${signal}，正在关闭机器人…`);
    shutdownBot(client, database);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  await client.login(config.token);
  return client;
}

if (require.main === module) {
  main().catch(error => {
    console.error('机器人启动失败：', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, prepareRuntime };

'use strict';

const path = require('node:path');
const { REST, Routes } = require('discord.js');
const { loadConfig } = require('./config');
const { loadCommands } = require('./command-loader');
const { configureProxy, applyRestAgent } = require('./network');

function configureRestProxy(rest, proxyUrl, networkFactory = configureProxy) {
  const { restAgent } = networkFactory(proxyUrl);
  return applyRestAgent(rest, restAgent);
}

async function deployCommands({ config, commands, rest }) {
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commands });
}

async function main() {
  require('dotenv').config();
  const config = loadConfig(process.env, __dirname);
  const { json } = loadCommands(path.resolve(__dirname, 'commands'));
  const rest = configureRestProxy(
    new REST({ version: '10' }).setToken(config.token),
    config.proxyUrl
  );
  await deployCommands({ config, commands: json, rest });
  console.log(`已部署 ${json.length} 条斜杠命令${config.guildId ? '到测试服务器' : '到全局'}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('命令部署失败：', error.message);
    process.exitCode = 1;
  });
}

module.exports = { deployCommands, configureRestProxy, main };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Collection } = require('discord.js');

function loadCommands(directory) {
  const collection = new Collection();
  const json = [];
  const filenames = fs.readdirSync(directory)
    .filter(filename => filename.endsWith('.js'))
    .sort();

  for (const filename of filenames) {
    const command = require(path.resolve(directory, filename));
    if (
      !command?.data?.name ||
      typeof command.data.toJSON !== 'function' ||
      typeof command.execute !== 'function'
    ) {
      throw new Error(`无效命令模块：${filename}`);
    }
    if (collection.has(command.data.name)) {
      throw new Error(`命令名称重复：${command.data.name}`);
    }

    collection.set(command.data.name, command);
    json.push(command.data.toJSON());
  }

  return { collection, json };
}

module.exports = { loadCommands };

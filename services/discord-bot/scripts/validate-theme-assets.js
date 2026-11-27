'use strict';

const path = require('node:path');
const { validateThemeAssets } = require('../theme-assets');

async function main() {
  const assetDirectory = path.resolve(__dirname, '../assets/theme');
  const result = await validateThemeAssets(assetDirectory);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`主题素材校验失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };

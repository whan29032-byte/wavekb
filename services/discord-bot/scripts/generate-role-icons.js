'use strict';

const path = require('node:path');
const { generateRoleIcons } = require('../theme-assets');

async function main() {
  const outputDirectory = path.resolve(__dirname, '../assets/theme');
  const files = await generateRoleIcons(outputDirectory);
  console.log(`已生成 ${files.length} 个角色视觉文件：${outputDirectory}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`角色图标生成失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };

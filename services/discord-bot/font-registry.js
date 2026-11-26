'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { GlobalFonts } = require('@napi-rs/canvas');

const BUNDLED_FONT_FAMILY = 'YouyouNotoSansCJKSC';
const BUNDLED_FONT_PATH = path.resolve(
  __dirname,
  'assets/fonts/NotoSansCJKsc-Regular.otf'
);

function registerBundledFont() {
  if (GlobalFonts.has(BUNDLED_FONT_FAMILY)) return BUNDLED_FONT_FAMILY;

  if (!fs.existsSync(BUNDLED_FONT_PATH)) {
    throw new Error(`Discord 图片字体文件不存在：${BUNDLED_FONT_PATH}`);
  }

  const registered = GlobalFonts.registerFromPath(
    BUNDLED_FONT_PATH,
    BUNDLED_FONT_FAMILY
  );
  if (!registered || !GlobalFonts.has(BUNDLED_FONT_FAMILY)) {
    throw new Error(`Discord 图片字体注册失败：${BUNDLED_FONT_PATH}`);
  }

  return BUNDLED_FONT_FAMILY;
}

registerBundledFont();

module.exports = {
  BUNDLED_FONT_FAMILY,
  registerBundledFont
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const {
  BUNDLED_FONT_FAMILY,
  registerBundledFont
} = require('../font-registry');

const FONT_PATH = path.resolve(__dirname, '../assets/fonts/NotoSansCJKsc-Regular.otf');
const LICENSE_PATH = path.resolve(__dirname, '../assets/fonts/OFL.txt');

function countInkPixels(fontPrefix) {
  const canvas = createCanvas(320, 100);
  const context = canvas.getContext('2d');
  context.font = `${fontPrefix}36px ${BUNDLED_FONT_FAMILY}`;
  context.fillStyle = '#000000';
  context.fillText('魔法 Lv.2', 10, 58);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 32) ink += 1;
  }
  return ink;
}

test('bundled font registers idempotently and renders Chinese and Latin glyph pixels', () => {
  assert.ok(fs.statSync(FONT_PATH).size > 1_000_000);
  assert.match(fs.readFileSync(LICENSE_PATH, 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);

  assert.equal(registerBundledFont(), BUNDLED_FONT_FAMILY);
  assert.equal(registerBundledFont(), BUNDLED_FONT_FAMILY);
  assert.equal(GlobalFonts.has(BUNDLED_FONT_FAMILY), true);
  assert.ok(countInkPixels('') > 500);
  assert.ok(countInkPixels('bold ') > 500);
});

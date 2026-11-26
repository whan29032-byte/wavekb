'use strict';

const { createCanvas } = require('@napi-rs/canvas');
const { BUNDLED_FONT_FAMILY, registerBundledFont } = require('../font-registry');

function countInkPixels(text, fontPrefix = '') {
  const canvas = createCanvas(320, 100);
  const context = canvas.getContext('2d');
  context.font = `${fontPrefix}36px ${BUNDLED_FONT_FAMILY}`;
  context.fillStyle = '#000000';
  context.fillText(text, 10, 58);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 32) ink += 1;
  }
  return ink;
}

registerBundledFont();
const chineseInk = countInkPixels('魔法');
const latinInk = countInkPixels('Lv.2', 'bold ');
if (chineseInk <= 500 || latinInk <= 500) {
  throw new Error(
    `Discord font rendering verification failed: Chinese=${chineseInk}, Latin=${latinInk}`
  );
}

console.log(`Discord font rendering verified: Chinese=${chineseInk}, Latin=${latinInk}`);

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { drawCard, drawImageCover, fitText, getTheme } = require('../canvas');
const { BUNDLED_FONT_FAMILY } = require('../font-registry');
const { getCardData } = require('../profile');

const backgroundPaths = {
  esper: path.resolve(__dirname, '../assets/bg-esper.png'),
  magician: path.resolve(__dirname, '../assets/bg-magician.png')
};

function createAvatarBuffer() {
  const avatar = createCanvas(64, 64);
  const context = avatar.getContext('2d');
  context.fillStyle = '#ff44aa';
  context.fillRect(0, 0, 64, 64);
  return avatar.toBuffer('image/png');
}

async function readPixel(buffer, x, y) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

function luminance([red, green, blue]) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function parseHexColor(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  assert.ok(match, `expected an opaque six-digit hex color, received ${value}`);
  return [0, 2, 4].map(offset => Number.parseInt(match[1].slice(offset, offset + 2), 16));
}

function relativeLuminance(hexColor) {
  const channels = parseHexColor(hexColor).map(channel => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function buildUser(profilePath, overrides = {}) {
  return {
    user_id: 'user-1',
    path: profilePath,
    level: 12,
    xp: 0,
    xp_needed: 100,
    total_xp: 1234,
    rank: 7,
    ability_name: '超长能力名称超长能力名称超长能力名称',
    chant: '这是一段非常非常长的咏唱，用于确认文字不会越过卡片边界',
    ...overrides
  };
}

const discordUser = {
  username: '非常非常长的Discord用户名用于测试溢出',
  displayAvatarURL() {
    throw new Error('test should use the injected local avatar');
  }
};

test('drawImageCover crops the source to the destination aspect ratio', () => {
  let argumentsReceived;
  const context = {
    drawImage(...args) {
      argumentsReceived = args;
    }
  };
  const image = { width: 1168, height: 784 };

  drawImageCover(context, image, 0, 0, 900, 320);

  const [, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height] = argumentsReceived;
  assert.equal(sourceX, 0);
  assert.ok(sourceY > 0);
  assert.equal(sourceWidth, 1168);
  assert.ok(Math.abs(sourceWidth / sourceHeight - 900 / 320) < 0.000001);
  assert.deepEqual([x, y, width, height], [0, 0, 900, 320]);
});

test('fitText keeps long real-font card fields within every production pixel limit', () => {
  const context = createCanvas(900, 320).getContext('2d');
  const cases = [
    { font: `bold 25px ${BUNDLED_FONT_FAMILY}`, width: 430, text: '极长Discord用户名'.repeat(20) },
    { font: `15px ${BUNDLED_FONT_FAMILY}`, width: 650, text: '极长能力或术式名称'.repeat(30) },
    { font: `15px ${BUNDLED_FONT_FAMILY}`, width: 680, text: '极长发动词或魔法咏唱'.repeat(30) }
  ];

  for (const entry of cases) {
    context.font = entry.font;
    const fitted = fitText(context, entry.text, entry.width);
    assert.equal(fitted.endsWith('…'), true);
    assert.ok(context.measureText(fitted).width <= entry.width);
  }
});

test('both card themes keep primary and secondary panel text at accessible contrast', () => {
  for (const pathName of ['esper', 'magician']) {
    const theme = getTheme(pathName);
    assert.ok(contrastRatio(theme.text, theme.panel) >= 4.5);
    assert.ok(contrastRatio(theme.secondaryText, theme.panel) >= 4.5);
  }
});

test('drawCard renders science and magic themes as distinct 900 by 320 PNGs', async () => {
  const avatarSource = createAvatarBuffer();
  const esper = buildUser('esper');
  const magician = buildUser('magician');

  const esperBuffer = await drawCard(esper, getCardData(esper), discordUser, {
    backgroundPaths,
    avatarSource
  });
  const magicianBuffer = await drawCard(magician, getCardData(magician), discordUser, {
    backgroundPaths,
    avatarSource
  });

  assert.deepEqual(Array.from(esperBuffer.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const esperImage = await loadImage(esperBuffer);
  const magicianImage = await loadImage(magicianBuffer);
  assert.deepEqual([esperImage.width, esperImage.height], [900, 320]);
  assert.deepEqual([magicianImage.width, magicianImage.height], [900, 320]);
  assert.notDeepEqual(esperBuffer, magicianBuffer);

  const esperBackground = await readPixel(esperBuffer, 450, 8);
  const magicianBackground = await readPixel(magicianBuffer, 450, 8);
  assert.ok(luminance(esperBackground) > 160);
  assert.ok(luminance(magicianBackground) < 80);
});

test('drawCard renders avatar bytes returned by the injected CDN fetcher', async () => {
  const avatarBuffer = createAvatarBuffer();
  const requestedUrls = [];
  const user = buildUser('esper');
  const remoteUser = {
    username: 'avatar-user',
    displayAvatarURL(options) {
      assert.deepEqual(options, { extension: 'png', size: 128 });
      return 'not-a-local-image-path';
    }
  };

  const buffer = await drawCard(user, getCardData(user), remoteUser, {
    backgroundPaths,
    async avatarFetcher(url) {
      requestedUrls.push(url);
      return avatarBuffer;
    }
  });

  assert.deepEqual(requestedUrls, ['not-a-local-image-path']);
  assert.deepEqual(await readPixel(buffer, 72, 100), [255, 68, 170, 255]);
});

test('drawCard clamps the progress fill between empty and full', async () => {
  const avatarSource = createAvatarBuffer();
  const empty = buildUser('esper', { xp: 0 });
  const full = buildUser('esper', { xp: 200 });

  const emptyBuffer = await drawCard(empty, getCardData(empty), discordUser, {
    backgroundPaths,
    avatarSource
  });
  const fullBuffer = await drawCard(full, getCardData(full), discordUser, {
    backgroundPaths,
    avatarSource
  });

  const emptyBarPixel = await readPixel(emptyBuffer, 500, 282);
  const fullBarPixel = await readPixel(fullBuffer, 500, 282);
  assert.notDeepEqual(emptyBarPixel, fullBarPixel);
});

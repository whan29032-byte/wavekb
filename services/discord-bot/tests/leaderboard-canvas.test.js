'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { drawLeaderboard } = require('../leaderboard-canvas');

const backgroundPaths = {
  esper: path.resolve(__dirname, '../assets/bg-esper.png'),
  magician: path.resolve(__dirname, '../assets/bg-magician.png')
};

function avatarBuffer(color = '#ff44aa') {
  const canvas = createCanvas(32, 32);
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 32, 32);
  return canvas.toBuffer('image/png');
}

function entry(index, profilePath = index % 2 === 0 ? 'esper' : 'magician') {
  return {
    user_id: `user-${String(index).padStart(2, '0')}`,
    path: profilePath,
    level: 12 - index,
    total_xp: 12_000 - index * 500,
    rank: index + 1,
    discordUser: {
      id: `user-${index}`,
      username: `参赛者${index}`,
      displayAvatarURL: () => `https://cdn.discordapp.com/avatar-${index}.png`
    }
  };
}

async function rgbaAt(buffer, x, y) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

test('drawLeaderboard renders distinct total science and magic 1000 by 760 PNGs', async () => {
  const rows = [entry(0)];
  const options = {
    backgroundPaths,
    avatarFetcher: async () => avatarBuffer()
  };

  const total = await drawLeaderboard(rows, 'all', options);
  const science = await drawLeaderboard(rows, 'esper', options);
  const magic = await drawLeaderboard(rows, 'magician', options);
  const decoded = await Promise.all([total, science, magic].map(loadImage));

  for (const image of decoded) {
    assert.equal(image.width, 1000);
    assert.equal(image.height, 760);
  }
  assert.deepEqual(Array.from(total.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.notDeepEqual(await rgbaAt(science, 20, 20), await rgbaAt(magic, 20, 20));
  assert.notDeepEqual(await rgbaAt(total, 980, 20), await rgbaAt(science, 980, 20));
  assert.notDeepEqual(await rgbaAt(total, 20, 20), await rgbaAt(magic, 20, 20));
});

test('drawLeaderboard paints proxy-fetched avatars for only the first ten entries', async () => {
  const requestedUrls = [];
  const rows = Array.from({ length: 12 }, (_, index) => entry(index));

  const buffer = await drawLeaderboard(rows, 'all', {
    backgroundPaths,
    async avatarFetcher(url) {
      requestedUrls.push(url);
      return avatarBuffer();
    }
  });

  assert.equal(requestedUrls.length, 10);
  assert.deepEqual(
    requestedUrls.slice().sort(),
    Array.from({ length: 10 }, (_, index) =>
      `https://cdn.discordapp.com/avatar-${index}.png`
    ).sort()
  );
  assert.deepEqual(await rgbaAt(buffer, 112, 153), [255, 68, 170, 255]);
});

test('drawLeaderboard keeps rendering when an avatar download fails', async () => {
  const buffer = await drawLeaderboard([entry(0)], 'esper', {
    backgroundPaths,
    async avatarFetcher() {
      throw new Error('CDN unavailable');
    }
  });
  const image = await loadImage(buffer);

  assert.equal(image.width, 1000);
  assert.equal(image.height, 760);
  assert.notDeepEqual(await rgbaAt(buffer, 112, 153), [255, 68, 170, 255]);
});

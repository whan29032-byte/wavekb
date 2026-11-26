'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const {
  ASSET_SPECS,
  ROLE_ICON_KEYS,
  generateRoleIcons,
  validateThemeAssets
} = require('../theme-assets');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-theme-assets-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function png(width, height, color = '#123456') {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
}

async function createValidAssets(t) {
  const directory = temporaryDirectory(t);
  fs.mkdirSync(path.join(directory, 'role-icons'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'server-icon.png'), png(1024, 1024, '#55c7f3'));
  fs.writeFileSync(path.join(directory, 'server-banner.png'), png(1920, 1080, '#08142f'));
  fs.writeFileSync(path.join(directory, 'invite-splash.png'), png(1920, 1080, '#25144d'));
  await generateRoleIcons(directory);
  return directory;
}

test('asset specs lock Discord dimensions, budgets, and all role icon keys', () => {
  assert.deepEqual(ASSET_SPECS.main, {
    'server-icon.png': { width: 1024, height: 1024, maxBytes: 5 * 1024 * 1024 },
    'server-banner.png': { width: 1920, height: 1080, maxBytes: 5 * 1024 * 1024 },
    'invite-splash.png': { width: 1920, height: 1080, maxBytes: 5 * 1024 * 1024 }
  });
  assert.equal(ASSET_SPECS.roleIcon.width, 64);
  assert.equal(ASSET_SPECS.roleIcon.height, 64);
  assert.equal(ASSET_SPECS.roleIcon.maxBytes, 128 * 1024);
  assert.deepEqual(ROLE_ICON_KEYS, [
    'stage-1',
    'stage-2',
    'stage-3',
    'stage-4',
    'stage-5',
    'stage-6',
    'magic-stage-1',
    'magic-stage-2',
    'magic-stage-3',
    'magic-stage-4',
    'magic-stage-5',
    'magic-stage-6',
    'route-esper',
    'route-magician',
    'special-gemstone',
    'special-saint',
    'bot-grimoire'
  ]);
});

test('generated role icons are distinct 64px PNGs and preview contains all icons', async t => {
  const directory = await createValidAssets(t);

  const result = await validateThemeAssets(directory);

  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 21);
  const icons = result.files.filter(({ kind }) => kind === 'role-icon');
  assert.equal(icons.length, 17);
  assert.equal(icons.every(({ width, height, format }) => width === 64 && height === 64 && format === 'png'), true);
  assert.equal(new Set(icons.map(({ hash }) => hash)).size, 17);
  const preview = result.files.find(({ kind }) => kind === 'preview');
  assert.equal(preview.previewSlots, 17);

  const previewImage = await loadImage(path.join(directory, 'role-icons-preview.png'));
  assert.equal(previewImage.width, ASSET_SPECS.preview.width);
  assert.equal(previewImage.height, 256);
});

test('validation reports missing, malformed, empty, oversized, and wrong-size assets', async t => {
  const missing = await createValidAssets(t);
  fs.rmSync(path.join(missing, 'role-icons', 'stage-1.png'));
  let result = await validateThemeAssets(missing);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /stage-1\.png.*缺失/);

  const wrongSize = await createValidAssets(t);
  fs.writeFileSync(path.join(wrongSize, 'server-icon.png'), png(32, 32));
  result = await validateThemeAssets(wrongSize);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /server-icon\.png.*1024x1024/);

  const malformed = await createValidAssets(t);
  fs.writeFileSync(path.join(malformed, 'server-banner.png'), Buffer.from('not-a-png'));
  result = await validateThemeAssets(malformed);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /server-banner\.png.*PNG/);

  const empty = await createValidAssets(t);
  fs.writeFileSync(path.join(empty, 'invite-splash.png'), Buffer.alloc(0));
  result = await validateThemeAssets(empty);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /invite-splash\.png.*空文件/);

  const oversized = await createValidAssets(t);
  fs.appendFileSync(
    path.join(oversized, 'role-icons', 'stage-2.png'),
    Buffer.alloc(ASSET_SPECS.roleIcon.maxBytes)
  );
  result = await validateThemeAssets(oversized);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /stage-2\.png.*128 KiB/);
});

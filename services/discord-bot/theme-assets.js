'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ROLE_ICON_KEYS = Object.freeze([
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

const ASSET_SPECS = Object.freeze({
  main: Object.freeze({
    'server-icon.png': Object.freeze({ width: 1024, height: 1024, maxBytes: 5 * 1024 * 1024 }),
    'server-banner.png': Object.freeze({ width: 1920, height: 1080, maxBytes: 5 * 1024 * 1024 }),
    'invite-splash.png': Object.freeze({ width: 1920, height: 1080, maxBytes: 5 * 1024 * 1024 })
  }),
  roleIcon: Object.freeze({ width: 64, height: 64, maxBytes: 128 * 1024 }),
  preview: Object.freeze({
    width: 496,
    height: 256,
    columns: 6,
    margin: 16,
    gap: 16,
    maxBytes: 1024 * 1024
  })
});

const STAGE_COLORS = ['#718096', '#66bfe8', '#39baf0', '#3b82f6', '#8b5cf6', '#e4c66a'];
const MAGIC_STAGE_COLORS = ['#6b7280', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#e4c66a'];

function drawRing(context, color, width = 4) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.arc(32, 32, 26, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = 'rgba(226, 240, 255, 0.55)';
  context.lineWidth = 1;
  context.beginPath();
  context.arc(32, 32, 20, 0, Math.PI * 2);
  context.stroke();
}

function drawStageIcon(context, stage) {
  const color = STAGE_COLORS[stage - 1];
  drawRing(context, color);
  context.fillStyle = color;
  context.beginPath();
  context.arc(32, 32, 7 + stage, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  for (let index = 0; index < stage; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / stage;
    context.beginPath();
    context.moveTo(32 + Math.cos(angle) * 13, 32 + Math.sin(angle) * 13);
    context.lineTo(32 + Math.cos(angle) * 22, 32 + Math.sin(angle) * 22);
    context.stroke();
  }
}

function drawMagicStageIcon(context, stage) {
  const color = MAGIC_STAGE_COLORS[stage - 1];
  drawRing(context, color);
  context.strokeStyle = color;
  context.lineWidth = 1.8;
  context.beginPath();
  const points = 5 + stage;
  for (let index = 0; index < points; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / points;
    const radius = index % 2 === 0 ? 18 : 10;
    const x = 32 + Math.cos(angle) * radius;
    const y = 32 + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.stroke();
  context.fillStyle = color;
  context.beginPath();
  context.arc(32, 32, 3 + stage / 2, 0, Math.PI * 2);
  context.fill();
}

function drawEsperIcon(context) {
  drawRing(context, '#55c7f3');
  context.strokeStyle = '#55c7f3';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(36, 11);
  context.lineTo(23, 32);
  context.lineTo(31, 32);
  context.lineTo(26, 53);
  context.lineTo(43, 27);
  context.lineTo(34, 27);
  context.closePath();
  context.stroke();
  context.fillStyle = '#dff7ff';
  for (const [x, y] of [[14, 25], [50, 20], [50, 44], [14, 43]]) {
    context.beginPath();
    context.arc(x, y, 2, 0, Math.PI * 2);
    context.fill();
  }
}

function drawMagicianIcon(context) {
  drawRing(context, '#8b5cf6');
  context.strokeStyle = '#c9b8ff';
  context.lineWidth = 1.8;
  context.beginPath();
  for (let index = 0; index < 6; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3;
    const x = 32 + Math.cos(angle) * 17;
    const y = 32 + Math.sin(angle) * 17;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.stroke();
  context.beginPath();
  context.arc(32, 32, 8, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = '#8b5cf6';
  context.beginPath();
  context.arc(32, 32, 3, 0, Math.PI * 2);
  context.fill();
}

function drawGemstoneIcon(context) {
  drawRing(context, '#55c7f3');
  context.fillStyle = '#bfefff';
  context.strokeStyle = '#40b7ec';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(32, 12);
  context.lineTo(48, 25);
  context.lineTo(41, 49);
  context.lineTo(23, 49);
  context.lineTo(16, 25);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(16, 25);
  context.lineTo(48, 25);
  context.moveTo(32, 12);
  context.lineTo(25, 25);
  context.lineTo(32, 47);
  context.lineTo(39, 25);
  context.stroke();
}

function drawSaintIcon(context) {
  drawRing(context, '#b99af2');
  context.strokeStyle = '#eadfff';
  context.lineWidth = 3;
  for (let index = 0; index < 6; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3;
    context.beginPath();
    context.moveTo(32 + Math.cos(angle) * 8, 32 + Math.sin(angle) * 8);
    context.lineTo(32 + Math.cos(angle) * 21, 32 + Math.sin(angle) * 21);
    context.stroke();
  }
  context.fillStyle = '#b99af2';
  context.beginPath();
  context.arc(32, 32, 8, 0, Math.PI * 2);
  context.fill();
}

function drawGrimoireIcon(context) {
  drawRing(context, '#718cf7');
  const gradient = context.createLinearGradient(15, 0, 49, 0);
  gradient.addColorStop(0, '#55c7f3');
  gradient.addColorStop(0.5, '#356fc4');
  gradient.addColorStop(0.51, '#7044bd');
  gradient.addColorStop(1, '#b99af2');
  context.fillStyle = gradient;
  context.strokeStyle = '#e8efff';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(12, 20);
  context.quadraticCurveTo(23, 16, 32, 23);
  context.quadraticCurveTo(41, 16, 52, 20);
  context.lineTo(49, 47);
  context.quadraticCurveTo(40, 43, 32, 49);
  context.quadraticCurveTo(24, 43, 15, 47);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(32, 23);
  context.lineTo(32, 49);
  context.stroke();
}

function renderRoleIcon(key) {
  const canvas = createCanvas(64, 64);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 64, 64);

  if (key.startsWith('stage-')) drawStageIcon(context, Number(key.split('-')[1]));
  else if (key.startsWith('magic-stage-')) drawMagicStageIcon(context, Number(key.split('-')[2]));
  else if (key === 'route-esper') drawEsperIcon(context);
  else if (key === 'route-magician') drawMagicianIcon(context);
  else if (key === 'special-gemstone') drawGemstoneIcon(context);
  else if (key === 'special-saint') drawSaintIcon(context);
  else if (key === 'bot-grimoire') drawGrimoireIcon(context);
  else throw new RangeError(`未知角色图标：${key}`);

  return canvas.toBuffer('image/png');
}

function previewPosition(index) {
  const { columns, margin, gap } = ASSET_SPECS.preview;
  return {
    x: margin + (index % columns) * (64 + gap),
    y: margin + Math.floor(index / columns) * (64 + gap)
  };
}

async function generateRoleIcons(outputDirectory) {
  const iconDirectory = path.join(outputDirectory, 'role-icons');
  await fs.mkdir(iconDirectory, { recursive: true });
  const written = [];
  const preview = createCanvas(ASSET_SPECS.preview.width, ASSET_SPECS.preview.height);
  const previewContext = preview.getContext('2d');
  previewContext.clearRect(0, 0, preview.width, preview.height);

  for (let index = 0; index < ROLE_ICON_KEYS.length; index += 1) {
    const key = ROLE_ICON_KEYS[index];
    const buffer = renderRoleIcon(key);
    const iconPath = path.join(iconDirectory, `${key}.png`);
    await fs.writeFile(iconPath, buffer);
    written.push(iconPath);
    const image = await loadImage(buffer);
    const { x, y } = previewPosition(index);
    previewContext.drawImage(image, x, y, 64, 64);
  }

  const previewPath = path.join(outputDirectory, 'role-icons-preview.png');
  await fs.writeFile(previewPath, preview.toBuffer('image/png'));
  written.push(previewPath);
  return written;
}

function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function countPreviewSlots(image) {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  let slots = 0;
  for (let index = 0; index < ROLE_ICON_KEYS.length; index += 1) {
    const { x, y } = previewPosition(index);
    const pixels = context.getImageData(x, y, 64, 64).data;
    let visible = false;
    for (let offset = 3; offset < pixels.length; offset += 4) {
      if (pixels[offset] > 0) {
        visible = true;
        break;
      }
    }
    if (visible) slots += 1;
  }
  return slots;
}

async function inspectAsset(assetPath, relativeName, spec, kind, errors) {
  let buffer;
  try {
    buffer = await fs.readFile(assetPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      errors.push(`${relativeName} 缺失`);
      return null;
    }
    throw error;
  }

  if (buffer.length === 0) {
    errors.push(`${relativeName} 是空文件`);
    return null;
  }
  if (buffer.length > spec.maxBytes) {
    const budget = spec.maxBytes === ASSET_SPECS.roleIcon.maxBytes ? '128 KiB' : `${spec.maxBytes} bytes`;
    errors.push(`${relativeName} 超过 ${budget} 上传预算`);
  }
  if (!isPng(buffer)) {
    errors.push(`${relativeName} 必须是 PNG`);
    return null;
  }

  let image;
  try {
    image = await loadImage(buffer);
  } catch {
    errors.push(`${relativeName} 不是可读取的 PNG`);
    return null;
  }
  if (image.width !== spec.width || image.height !== spec.height) {
    errors.push(`${relativeName} 必须为 ${spec.width}x${spec.height}`);
  }

  const result = {
    name: relativeName,
    kind,
    width: image.width,
    height: image.height,
    size: buffer.length,
    format: 'png',
    hash: crypto.createHash('sha256').update(buffer).digest('hex')
  };
  if (kind === 'preview') result.previewSlots = countPreviewSlots(image);
  return result;
}

async function validateThemeAssets(assetDirectory) {
  const errors = [];
  const files = [];

  for (const [filename, spec] of Object.entries(ASSET_SPECS.main)) {
    const inspected = await inspectAsset(path.join(assetDirectory, filename), filename, spec, 'main', errors);
    if (inspected) files.push(inspected);
  }
  for (const key of ROLE_ICON_KEYS) {
    const relativeName = `role-icons/${key}.png`;
    const inspected = await inspectAsset(
      path.join(assetDirectory, relativeName),
      relativeName,
      ASSET_SPECS.roleIcon,
      'role-icon',
      errors
    );
    if (inspected) files.push(inspected);
  }
  const preview = await inspectAsset(
    path.join(assetDirectory, 'role-icons-preview.png'),
    'role-icons-preview.png',
    ASSET_SPECS.preview,
    'preview',
    errors
  );
  if (preview) {
    if (preview.previewSlots !== ROLE_ICON_KEYS.length) {
      errors.push(`role-icons-preview.png 只包含 ${preview.previewSlots}/${ROLE_ICON_KEYS.length} 个图标槽位`);
    }
    files.push(preview);
  }

  const roleHashes = files.filter(({ kind }) => kind === 'role-icon').map(({ hash }) => hash);
  if (roleHashes.length === ROLE_ICON_KEYS.length && new Set(roleHashes).size !== roleHashes.length) {
    errors.push('角色图标文件哈希必须互不相同');
  }

  return { ok: errors.length === 0, errors, files };
}

async function adaptMainVisual(inputPath, outputPath, width, height) {
  const image = await loadImage(inputPath);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const sourceAspect = image.width / image.height;
  const destinationAspect = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  if (sourceAspect > destinationAspect) {
    sourceWidth = image.height * destinationAspect;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = image.width / destinationAspect;
    sourceY = (image.height - sourceHeight) / 2;
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, canvas.toBuffer('image/png'));
  return outputPath;
}

module.exports = {
  ASSET_SPECS,
  ROLE_ICON_KEYS,
  generateRoleIcons,
  validateThemeAssets,
  adaptMainVisual
};

'use strict';

const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { drawImageCover, fitText } = require('./canvas');

const WIDTH = 1000;
const HEIGHT = 760;
const ROW_START_Y = 128;
const ROW_HEIGHT = 58;
const AVATAR_X = 112;
const FONT_FAMILY = '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const DEFAULT_BACKGROUND_PATHS = {
  esper: path.resolve(__dirname, 'assets/bg-esper.png'),
  magician: path.resolve(__dirname, 'assets/bg-magician.png')
};
const SCOPE_THEMES = {
  all: {
    title: '学园都市 × 魔法侧｜综合排行榜',
    subtitle: '累计经验 TOP 10',
    text: '#f5f8ff',
    secondary: '#c7d7f2',
    row: 'rgba(5, 15, 39, 0.78)',
    accent: '#62c9ff',
    overlay: 'rgba(2, 8, 24, 0.34)'
  },
  esper: {
    title: '学园都市｜科学侧排行榜',
    subtitle: '能力者累计经验 TOP 10',
    text: '#163b66',
    secondary: '#496f99',
    row: 'rgba(239, 249, 255, 0.88)',
    accent: '#159fda',
    overlay: 'rgba(255, 255, 255, 0.20)'
  },
  magician: {
    title: '魔法侧｜术式排行榜',
    subtitle: '魔法师累计经验 TOP 10',
    text: '#f1f5ff',
    secondary: '#becdf0',
    row: 'rgba(7, 19, 47, 0.86)',
    accent: '#8a7dff',
    overlay: 'rgba(0, 5, 20, 0.28)'
  }
};
const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN');

function roundRect(context, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function fillRoundedRect(context, x, y, width, height, radius, color) {
  roundRect(context, x, y, width, height, radius);
  context.fillStyle = color;
  context.fill();
}

async function loadEntryAvatar(entry, avatarFetcher) {
  try {
    const avatarUrl = entry.discordUser.displayAvatarURL({ extension: 'png', size: 128 });
    const source = avatarFetcher ? await avatarFetcher(avatarUrl) : avatarUrl;
    return await loadImage(source);
  } catch {
    return null;
  }
}

function drawBackground(context, scope, backgrounds) {
  if (scope === 'all') {
    drawImageCover(context, backgrounds.esper, 0, 0, WIDTH / 2, HEIGHT);
    drawImageCover(context, backgrounds.magician, WIDTH / 2, 0, WIDTH / 2, HEIGHT);
  } else {
    drawImageCover(context, backgrounds[scope], 0, 0, WIDTH, HEIGHT);
  }
}

function drawAvatar(context, avatar, entry, y, theme) {
  const centerY = y + 25;
  context.fillStyle = entry.path === 'magician'
    ? 'rgba(138, 125, 255, 0.30)'
    : 'rgba(21, 159, 218, 0.24)';
  context.beginPath();
  context.arc(AVATAR_X, centerY, 21, 0, Math.PI * 2);
  context.fill();

  if (avatar) {
    context.save();
    context.beginPath();
    context.arc(AVATAR_X, centerY, 19, 0, Math.PI * 2);
    context.clip();
    context.drawImage(avatar, AVATAR_X - 19, centerY - 19, 38, 38);
    context.restore();
  } else {
    context.fillStyle = theme.text;
    context.font = `bold 16px ${FONT_FAMILY}`;
    context.textAlign = 'center';
    const username = entry.discordUser?.username || entry.user_id || '?';
    context.fillText(Array.from(username)[0] || '?', AVATAR_X, centerY + 6);
    context.textAlign = 'left';
  }

  context.strokeStyle = entry.path === 'magician' ? '#9d91ff' : '#31b8ee';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(AVATAR_X, centerY, 21, 0, Math.PI * 2);
  context.stroke();
}

function medalColor(rank, fallback) {
  if (rank === 1) return '#f6c85f';
  if (rank === 2) return '#c8d1dc';
  if (rank === 3) return '#d89d64';
  return fallback;
}

function drawRow(context, entry, avatar, index, theme) {
  const y = ROW_START_Y + index * ROW_HEIGHT;
  fillRoundedRect(context, 36, y, 928, 50, 14, theme.row);

  context.fillStyle = medalColor(entry.rank, theme.accent);
  context.font = `bold 20px ${FONT_FAMILY}`;
  context.textAlign = 'center';
  context.fillText(`#${entry.rank}`, 66, y + 32);
  context.textAlign = 'left';

  drawAvatar(context, avatar, entry, y, theme);

  context.fillStyle = theme.text;
  context.font = `bold 17px ${FONT_FAMILY}`;
  const username = entry.discordUser?.username || `用户 ${entry.user_id}`;
  context.fillText(fitText(context, username, 280), 145, y + 22);

  context.fillStyle = theme.secondary;
  context.font = `13px ${FONT_FAMILY}`;
  const routeLabel = entry.path === 'magician' ? '魔法侧' : '科学侧';
  context.fillText(`${routeLabel} · ${entry.user_id}`, 145, y + 41);

  context.fillStyle = theme.text;
  context.font = `bold 17px ${FONT_FAMILY}`;
  context.fillText(`Lv.${entry.level}`, 610, y + 31);

  context.fillStyle = theme.secondary;
  context.font = `13px ${FONT_FAMILY}`;
  context.fillText('累计经验', 735, y + 20);
  context.fillStyle = theme.text;
  context.font = `bold 17px ${FONT_FAMILY}`;
  context.fillText(NUMBER_FORMAT.format(entry.total_xp), 735, y + 40);
}

async function drawLeaderboard(entries, scope = 'all', options = {}) {
  const theme = SCOPE_THEMES[scope];
  if (!theme) throw new RangeError(`未知排行榜范围：${scope}`);

  const backgroundPaths = options.backgroundPaths || DEFAULT_BACKGROUND_PATHS;
  const requiredBackgrounds = scope === 'all' ? ['esper', 'magician'] : [scope];
  const loadedBackgrounds = await Promise.all(
    requiredBackgrounds.map(async key => [key, await loadImage(backgroundPaths[key])])
  );
  const backgrounds = Object.fromEntries(loadedBackgrounds);
  const visibleEntries = entries.slice(0, 10);
  const avatars = await Promise.all(
    visibleEntries.map(item => loadEntryAvatar(item, options.avatarFetcher))
  );

  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  drawBackground(context, scope, backgrounds);
  context.fillStyle = theme.overlay;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = theme.text;
  context.font = `bold 30px ${FONT_FAMILY}`;
  context.fillText(theme.title, 40, 52);
  context.fillStyle = theme.secondary;
  context.font = `15px ${FONT_FAMILY}`;
  context.fillText(theme.subtitle, 42, 82);
  context.textAlign = 'right';
  context.fillText(`收录 ${visibleEntries.length} 名成员`, 960, 82);
  context.textAlign = 'left';

  visibleEntries.forEach((item, index) => {
    drawRow(context, item, avatars[index], index, theme);
  });

  context.fillStyle = theme.secondary;
  context.font = `12px ${FONT_FAMILY}`;
  context.fillText('排名依据：服务器累计经验', 40, 738);
  context.textAlign = 'right';
  context.fillText('悠悠的宝宝 · INDEX PROFILE SYSTEM', 960, 738);
  context.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

module.exports = { drawLeaderboard };

'use strict';

const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const WIDTH = 900;
const HEIGHT = 320;
const FONT_FAMILY = '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const DEFAULT_BACKGROUND_PATHS = {
  esper: path.resolve(__dirname, 'assets/bg-esper.png'),
  magician: path.resolve(__dirname, 'assets/bg-magician.png')
};
const THEMES = {
  esper: {
    text: '#163b66',
    secondaryText: '#496f99',
    accent: '#159fda',
    avatarBorder: '#31b8ee',
    panel: '#eff9ff',
    chip: 'rgba(21, 159, 218, 0.16)',
    progressTrack: 'rgba(54, 139, 194, 0.22)'
  },
  magician: {
    text: '#f1f5ff',
    secondaryText: '#becdf0',
    accent: '#8a7dff',
    avatarBorder: '#6fa7ff',
    panel: '#07132f',
    chip: 'rgba(138, 125, 255, 0.24)',
    progressTrack: 'rgba(154, 174, 224, 0.25)'
  }
};

function getTheme(profilePath) {
  const theme = THEMES[profilePath];
  if (!theme) throw new RangeError(`未知路线：${profilePath}`);
  return theme;
}

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

function drawImageCover(context, image, x, y, width, height) {
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

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height
  );
}

function fitText(context, value, maxWidth) {
  const text = String(value ?? '');
  if (context.measureText(text).width <= maxWidth) return text;

  const characters = Array.from(text);
  const ellipsis = '…';
  while (characters.length > 0) {
    characters.pop();
    const candidate = `${characters.join('')}${ellipsis}`;
    if (context.measureText(candidate).width <= maxWidth) return candidate;
  }
  return context.measureText(ellipsis).width <= maxWidth ? ellipsis : '';
}

function fillRoundedRect(context, x, y, width, height, radius, color) {
  roundRect(context, x, y, width, height, radius);
  context.fillStyle = color;
  context.fill();
}

async function loadAvatar(discordUser, avatarSource, avatarFetcher = null) {
  if (avatarSource) return loadImage(avatarSource);
  const avatarUrl = discordUser.displayAvatarURL({ extension: 'png', size: 128 });
  const imageSource = avatarFetcher ? await avatarFetcher(avatarUrl) : avatarUrl;
  return loadImage(imageSource);
}

function drawAvatarPlaceholder(context, discordUser, theme) {
  context.fillStyle = theme.chip;
  context.beginPath();
  context.arc(72, 100, 43, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = theme.text;
  context.font = `bold 30px ${FONT_FAMILY}`;
  context.textAlign = 'center';
  context.fillText(Array.from(discordUser.username || '?')[0] || '?', 72, 111);
  context.textAlign = 'left';
}

async function drawCard(user, cardData, discordUser, options = {}) {
  const theme = getTheme(user.path);

  const backgroundPaths = options.backgroundPaths || DEFAULT_BACKGROUND_PATHS;
  const background = await loadImage(backgroundPaths[user.path]);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  drawImageCover(context, background, 0, 0, WIDTH, HEIGHT);

  context.fillStyle = user.path === 'esper'
    ? 'rgba(255, 255, 255, 0.18)'
    : 'rgba(0, 5, 20, 0.18)';
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = theme.text;
  context.font = `bold 18px ${FONT_FAMILY}`;
  context.fillText(cardData.title, 28, 34);

  try {
    const avatar = await loadAvatar(
      discordUser,
      options.avatarSource,
      options.avatarFetcher
    );
    context.save();
    context.beginPath();
    context.arc(72, 100, 43, 0, Math.PI * 2);
    context.clip();
    context.drawImage(avatar, 29, 57, 86, 86);
    context.restore();
  } catch {
    drawAvatarPlaceholder(context, discordUser, theme);
  }

  context.beginPath();
  context.arc(72, 100, 47, 0, Math.PI * 2);
  context.strokeStyle = theme.avatarBorder;
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = theme.text;
  context.font = `bold 25px ${FONT_FAMILY}`;
  context.fillText(fitText(context, discordUser.username, 430), 138, 80);

  context.fillStyle = theme.secondaryText;
  context.font = `16px ${FONT_FAMILY}`;
  context.fillText(`${cardData.rankLabel} #${user.rank || '?'}`, 138, 109);

  context.fillStyle = theme.text;
  context.font = `bold 40px ${FONT_FAMILY}`;
  context.fillText(`Lv.${user.level}`, 138, 153);

  context.font = `15px ${FONT_FAMILY}`;
  const titleText = fitText(context, cardData.titleText, 260);
  const titleWidth = Math.min(context.measureText(titleText).width + 24, 284);
  fillRoundedRect(context, 278, 126, titleWidth, 34, 17, theme.chip);
  context.fillStyle = theme.text;
  context.fillText(titleText, 290, 149);

  fillRoundedRect(context, 20, 174, 860, 116, 16, theme.panel);
  context.fillStyle = theme.text;
  context.font = `15px ${FONT_FAMILY}`;
  const abilityText = fitText(context, user.ability_name || '未设置', 650);
  const chantText = fitText(context, user.chant || '未设置', 680);
  context.fillText(`${cardData.nameLabel}　${abilityText}`, 40, 205);
  context.fillText(`${cardData.chantLabel}　${chantText}`, 40, 231);
  context.fillText(`${cardData.advancedLabel}　${cardData.advancedText}`, 40, 257);

  fillRoundedRect(context, 40, 276, 540, 12, 6, theme.progressTrack);
  const denominator = user.xp_needed > 0 ? user.xp_needed : 1;
  const progress = Math.max(0, Math.min(user.xp / denominator, 1));
  if (progress > 0) {
    fillRoundedRect(context, 40, 276, 540 * progress, 12, 6, theme.accent);
  }

  context.fillStyle = theme.secondaryText;
  context.font = `13px ${FONT_FAMILY}`;
  context.fillText(`${cardData.powerLabel}  ${user.xp || 0} / ${user.xp_needed || 100}`, 40, 310);
  const totalText = `${cardData.totalLabel}  ${user.total_xp || 0}`;
  context.fillText(totalText, 875 - context.measureText(totalText).width, 310);

  return canvas.toBuffer('image/png');
}

module.exports = { drawCard, drawImageCover, fitText, getTheme };

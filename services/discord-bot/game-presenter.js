'use strict';

const { EmbedBuilder } = require('discord.js');

const routeTheme = {
  esper: { label: '科学侧', color: 0x3b82f6, icon: '⚡' },
  magician: { label: '魔法侧', color: 0x8b5cf6, icon: '🔮' }
};

const rarities = {
  common: { label: '普通', icon: '⚪' },
  rare: { label: '稀有', icon: '🔵' },
  epic: { label: '史诗', icon: '🟣' },
  legendary: { label: '传说', icon: '🟡' }
};

const marketNames = {
  academy: '学园都市科技指数',
  grimoire: '魔导书术式指数',
  petegg: '幻想宠物蛋指数'
};

function routeInfo(path) {
  return routeTheme[path] || routeTheme.esper;
}

function rarityInfo(rarity) {
  return rarities[rarity] || rarities.common;
}

function integer(value) {
  return Number.isInteger(value) ? value : 0;
}

function points(value) {
  return `${new Intl.NumberFormat('zh-CN').format(Math.max(0, integer(value)))} 积分`;
}

function gameEmbed(title, path = 'esper') {
  const theme = routeInfo(path);
  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(`${theme.icon} ${title}`)
    .setFooter({ text: `${theme.label} · WaveKB 网站积分实时同步` });
}

function skillLine(skill) {
  const rarity = rarityInfo(skill?.rarity);
  const duplicate = skill?.isNew === false
    ? ` · 重复补偿 +${integer(skill.compensation)}`
    : ' · 新收录';
  return `${rarity.icon} **${String(skill?.name || '未知技能')}**〔${rarity.label}〕${duplicate}`;
}

function collectionLine(skill) {
  const rarity = rarityInfo(skill?.rarity);
  return `${rarity.icon} **${String(skill?.name || '未知技能')}**〔${rarity.label}〕×${Math.max(1, integer(skill?.quantity))}`;
}

function pityText(pity = {}) {
  return `史诗保底计数 ${integer(pity.epic)}/10 · 传说保底计数 ${integer(pity.legendary)}/50`;
}

function marketName(symbol) {
  return marketNames[symbol] || '未知主题指数';
}

function percentage(basisPoints) {
  const value = Number.isInteger(basisPoints) ? basisPoints / 100 : 0;
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

module.exports = {
  collectionLine,
  gameEmbed,
  integer,
  marketName,
  percentage,
  pityText,
  points,
  rarityInfo,
  routeInfo,
  skillLine
};

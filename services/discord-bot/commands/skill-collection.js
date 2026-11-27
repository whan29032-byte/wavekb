'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { currentGamePath, executeGameAction } = require('../game-actions');
const { collectionLine, gameEmbed, pityText, points, routeInfo } = require('../game-presenter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('技能图鉴')
    .setDescription('查看当前阵营已收录技能和保底进度')
    .setDMPermission(false),

  async execute(interaction, context) {
    const path = currentGamePath(interaction, context);
    const result = await executeGameAction(interaction, context, 'skill_collection', { path });
    if (!result) return;
    const skills = Array.isArray(result.skills) ? result.skills : [];
    const lines = skills.slice(0, 30).map(collectionLine);
    const embed = gameEmbed(`${routeInfo(path).label}技能图鉴`, path)
      .setDescription(lines.join('\n') || '还没有收录技能，使用 **/技能抽奖** 开始收藏吧。')
      .addFields(
        { name: '已收录', value: `${skills.length} 种`, inline: true },
        { name: '积分余额', value: points(result.balance), inline: true },
        { name: '保底进度', value: pityText(result.pity), inline: false }
      );
    await interaction.editReply({ embeds: [embed] });
  }
};

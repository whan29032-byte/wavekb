'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { currentGamePath, executeGameAction, sendGameReply } = require('../game-actions');
const { gameEmbed, points } = require('../game-presenter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('打工')
    .setDescription('完成当前阵营工作并赚取网站积分')
    .setDMPermission(false),

  async execute(interaction, context) {
    const path = currentGamePath(interaction, context);
    const result = await executeGameAction(interaction, context, 'work', { path });
    if (!result) return;
    const next = Math.floor(Date.parse(result.nextAvailableAt) / 1000);
    const embed = gameEmbed('打工完成', path)
      .setDescription(`你完成了 **${String(result.job || '阵营委托')}**，获得 **${points(result.points)}**。`)
      .addFields(
        { name: '今日次数', value: `${result.workCount}/4`, inline: true },
        { name: '下次可用', value: Number.isFinite(next) ? `<t:${next}:R>` : '4 小时后', inline: true }
      );
    await sendGameReply(interaction, { embeds: [embed] }, { public: true });
  }
};

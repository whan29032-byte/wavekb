'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { currentGamePath, executeGameAction, sendGameReply } = require('../game-actions');
const { gameEmbed, pityText, points, skillLine } = require('../game-presenter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('技能抽奖')
    .setDescription('从当前阵营技能池抽取技能')
    .addIntegerOption(option => option
      .setName('次数')
      .setDescription('单抽 100 积分，十连 900 积分')
      .setRequired(false)
      .addChoices(
        { name: '单抽（100 积分）', value: 1 },
        { name: '十连（900 积分）', value: 10 }
      ))
    .setDMPermission(false),

  async execute(interaction, context) {
    const path = currentGamePath(interaction, context);
    const count = interaction.options.getInteger('次数') || 1;
    const result = await executeGameAction(interaction, context, 'skill_draw', { path, count });
    if (!result) return;
    const draws = Array.isArray(result.draws) ? result.draws : [];
    const embed = gameEmbed(`${count === 10 ? '十连' : '单抽'}技能结果`, path)
      .setDescription(draws.map(skillLine).join('\n') || '本次没有返回技能结果。')
      .addFields(
        { name: '本次消耗', value: points(result.cost), inline: true },
        { name: '保底进度', value: pityText(result.pity), inline: false }
      );
    await sendGameReply(interaction, { embeds: [embed] }, { public: true });
  }
};

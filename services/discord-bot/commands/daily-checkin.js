'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { executeGameAction, sendGameReply } = require('../game-actions');
const { gameEmbed, points } = require('../game-presenter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('签到')
    .setDescription('领取与 WaveKB 网站共享的每日签到积分')
    .setDMPermission(false),

  async execute(interaction, context) {
    const result = await executeGameAction(interaction, context, 'daily_checkin');
    if (!result) return;
    const embed = gameEmbed(result.awarded ? '签到成功' : '今天已经签到')
      .setDescription(result.awarded
        ? `获得 **${points(result.points)}**，连续签到 **${result.streak}** 天。`
        : `今日奖励已经领取；当前连续签到 **${result.streak}** 天。`);
    await sendGameReply(interaction, { embeds: [embed] }, { public: true });
  }
};

'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { executeGameAction } = require('../game-actions');
const { marketName, points } = require('../game-presenter');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('押注')
    .setDescription('使用社区虚拟积分猜测今日主题指数涨跌')
    .addStringOption(option => option
      .setName('品种')
      .setDescription('选择虚拟指数')
      .setRequired(true)
      .addChoices(
        { name: '学园都市科技指数', value: 'academy' },
        { name: '魔导书术式指数', value: 'grimoire' },
        { name: '幻想宠物蛋指数', value: 'petegg' }
      ))
    .addStringOption(option => option
      .setName('方向')
      .setDescription('预测上涨或下跌')
      .setRequired(true)
      .addChoices(
        { name: '上涨', value: 'up' },
        { name: '下跌', value: 'down' }
      ))
    .addIntegerOption(option => option
      .setName('积分')
      .setDescription('单笔 10–500，且每日累计最多 500')
      .setRequired(true)
      .setMinValue(10)
      .setMaxValue(500))
    .setDMPermission(false),

  async execute(interaction, context) {
    const symbol = interaction.options.getString('品种', true);
    const direction = interaction.options.getString('方向', true);
    const stake = interaction.options.getInteger('积分', true);
    const result = await executeGameAction(
      interaction, context, 'market_bet', { symbol, direction, stake }
    );
    if (!result) return;
    const embed = new EmbedBuilder()
      .setColor(direction === 'up' ? 0x43b581 : 0xed4245)
      .setTitle('🎫 虚拟行情押注已确认')
      .setDescription(`**${marketName(symbol)}** · **${direction === 'up' ? '上涨' : '下跌'}**`)
      .addFields(
        { name: '本次押注', value: points(result.stake), inline: true },
        { name: '今日累计', value: `${result.dailyStake}/500 积分`, inline: true },
        { name: '积分余额', value: points(result.balance), inline: true },
        { name: '结算规则', value: '22:00 后猜对返还押注额的 1.8 倍；猜错不返还。', inline: false },
        { name: '重要说明', value: '仅使用社区虚拟积分，不可购买、不可转账、不可提现。', inline: false }
      );
    await interaction.editReply({ embeds: [embed] });
  }
};

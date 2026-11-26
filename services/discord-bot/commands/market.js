'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { executeGameAction } = require('../game-actions');
const { marketName, percentage } = require('../game-presenter');

const phaseLabels = {
  open: '开放下注',
  closed: '已停盘，等待结算',
  settled: '今日已结算'
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('行情')
    .setDescription('查看每日三个主题虚拟指数的状态')
    .setDMPermission(false),

  async execute(interaction, context) {
    const result = await executeGameAction(interaction, context, 'market_view');
    if (!result) return;
    const symbols = Array.isArray(result.symbols) ? result.symbols : [];
    const settled = result.phase === 'settled';
    const lines = symbols.map(symbol => {
      if (!settled) return `🔒 **${marketName(symbol.symbol)}** — 结果尚未公布`;
      const icon = symbol.direction === 'up' ? '📈' : '📉';
      return `${icon} **${marketName(symbol.symbol)}** — ${percentage(symbol.changeBps)}`;
    });
    const embed = new EmbedBuilder()
      .setColor(0xf0b232)
      .setTitle('📊 每日虚拟行情')
      .setDescription(lines.join('\n') || '今日行情暂未生成。')
      .addFields(
        { name: '当前阶段', value: phaseLabels[result.phase] || '未知', inline: true },
        { name: '今日已押注', value: `${result.dailyStake || 0}/${result.dailyLimit || 500} 积分`, inline: true },
        { name: '时间（上海）', value: '21:00 停止下注 · 22:00 公布并结算', inline: false },
        { name: '风险说明', value: '仅为社区娱乐虚拟积分，不对应任何真实市场或资产。', inline: false }
      );
    await interaction.editReply({ embeds: [embed] });
  }
};

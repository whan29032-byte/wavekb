'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('玩法帮助')
    .setDescription('查看签到、打工、技能、行情和宠物玩法')
    .setDMPermission(false),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📖 学园都市 × 魔法侧玩法手册')
      .setDescription('先使用 **/绑定网站** 连接 WaveKB。所有收支都会同步到同一个网站积分账本。')
      .addFields(
        { name: '每日成长', value: '`/签到` 每日 5–11 分；`/打工` 每 4 小时一次、每日最多 4 次。' },
        { name: '双阵营技能', value: '`/技能抽奖` 单抽 100、十连 900；`/技能图鉴` 查看当前路线收藏与保底。' },
        { name: '虚拟行情', value: '`/行情` 查看三个主题指数；`/押注` 猜涨跌，21:00 停盘、22:00 结算。' },
        { name: '宠物系统', value: '`/宠物` 可查看商店、每日领养、购买宠物蛋、孵化、改名与出战。' },
        { name: '安全说明', value: '行情仅使用社区虚拟积分，不可购买、不可转账、不可提现，也不映射任何真实资产。' }
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

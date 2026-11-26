'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder
} = require('discord.js');

const GUILD_ONLY_MESSAGE = '此命令只能在已配置的 Discord 服务器中使用。';

function failureMessage(error) {
  if (error?.code === 'website_not_configured') {
    return '网站接入尚未配置，请联系服务器管理员。';
  }
  return 'WaveKB 网站暂时无法连接，绑定没有开始，请稍后再试。';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('绑定网站')
    .setDescription('把当前 Discord 账号安全绑定到 WaveKB')
    .setDMPermission(false),

  async execute(interaction, { websiteClient, websiteGuildId }) {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.guildId || (websiteGuildId && interaction.guildId !== websiteGuildId)) {
      await interaction.editReply({ content: GUILD_ONLY_MESSAGE });
      return;
    }
    try {
      const link = await websiteClient.createLink({
        discordUserId: interaction.user.id,
        guildId: interaction.guildId
      });
      const expiresAt = Math.floor(Date.parse(link.expiresAt) / 1000);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('打开 WaveKB 完成绑定')
          .setStyle(ButtonStyle.Link)
          .setURL(link.linkUrl)
      );
      await interaction.editReply({
        content: `请在网页中登录 WaveKB 并确认绑定。链接将在 <t:${expiresAt}:R> 过期（约 10 分钟），且只能使用一次。`,
        components: [row]
      });
    } catch (error) {
      await interaction.editReply({ content: failureMessage(error) });
    }
  }
};

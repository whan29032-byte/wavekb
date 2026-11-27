'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const GUILD_ONLY_MESSAGE = '此命令只能在已配置的 Discord 服务器中使用。';

function failureMessage(error) {
  const messages = {
    not_linked: '你还没有绑定 WaveKB。请先运行 **/绑定网站** 获取一次性链接。',
    account_restricted: '已绑定的 WaveKB 账号当前处于受限状态，无法显示资料。',
    website_not_configured: '网站接入尚未配置，请联系服务器管理员。'
  };
  return messages[error?.code] || 'WaveKB 网站暂时无法连接，身份组没有发生变化，请稍后再试。';
}

function syncLabel(result) {
  if (result?.status === 'synced') return '已同步';
  if (result?.status === 'already_synced') return '已是最新';
  if (result?.status === 'skipped') return '当前服务器未启用同步';
  return '同步失败，请确认机器人角色高于目标普通角色';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('网站账号')
    .setDescription('查看已绑定的 WaveKB 公开资料与积分')
    .setDMPermission(false),

  async execute(interaction, { websiteClient, syncWebsiteRoles, websiteGuildId }) {
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.guildId || (websiteGuildId && interaction.guildId !== websiteGuildId)) {
      await interaction.editReply({ content: GUILD_ONLY_MESSAGE });
      return;
    }
    let profile;
    try {
      profile = await websiteClient.getMember(interaction.user.id);
    } catch (error) {
      if (error?.code === 'not_linked' || error?.code === 'account_restricted') {
        try {
          await syncWebsiteRoles({
            member: interaction.member,
            guildId: interaction.guildId,
            profile: null
          });
        } catch {
          // Preserve the authoritative website status even if safe cleanup cannot run.
        }
      }
      await interaction.editReply({ content: failureMessage(error) });
      return;
    }

    let syncResult;
    try {
      syncResult = await syncWebsiteRoles({
        member: interaction.member,
        guildId: interaction.guildId,
        profile
      });
    } catch {
      syncResult = { status: 'failed', reason: 'unexpected_error' };
    }

    const embed = new EmbedBuilder()
      .setColor(0x3f6f9f)
      .setTitle(`${profile.displayName}的 WaveKB 账号`)
      .setDescription('以下数据来自已绑定的网站账号；Discord 本地等级与阵营进度保持独立。')
      .addFields(
        { name: '网站 UID', value: String(profile.uid), inline: true },
        { name: '网站称号', value: profile.displayTitle || '未设置', inline: true },
        { name: '铭牌', value: profile.nameplateStyle, inline: true },
        {
          name: '积分',
          value: `当前 ${profile.points.balance}｜累计 ${profile.points.lifetimeEarned}`,
          inline: false
        },
        { name: 'Discord 身份组', value: syncLabel(syncResult), inline: false }
      );
    if (profile.avatarUrl) embed.setThumbnail(profile.avatarUrl);
    await interaction.editReply({ embeds: [embed] });
  }
};

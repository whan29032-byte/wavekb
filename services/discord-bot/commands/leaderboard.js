'use strict';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');

const SCOPE_PATHS = {
  all: null,
  esper: 'esper',
  magician: 'magician'
};

function unavailableDiscordUser(userId) {
  return {
    id: userId,
    username: `未知用户 ${userId.slice(-4)}`,
    displayAvatarURL() {
      throw new Error('用户头像不可用');
    }
  };
}

async function resolveDiscordUser(client, userId) {
  try {
    return await client.users.fetch(userId);
  } catch {
    return unavailableDiscordUser(userId);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('排行榜')
    .setDescription('查看服务器总榜、科学侧或魔法侧排行榜')
    .addStringOption(option =>
      option
        .setName('范围')
        .setDescription('选择排行榜范围，默认显示总榜')
        .setRequired(false)
        .addChoices(
          { name: '总榜', value: 'all' },
          { name: '科学侧', value: 'esper' },
          { name: '魔法侧', value: 'magician' }
        )
    ),

  async execute(interaction, { database, drawLeaderboard }) {
    await interaction.deferReply();
    const scope = interaction.options.getString('范围') || 'all';
    const rows = database.getLeaderboard(interaction.guildId, {
      path: SCOPE_PATHS[scope],
      limit: 10
    });

    if (rows.length === 0) {
      await interaction.editReply('当前范围还没有排行榜数据。');
      return;
    }

    const entries = await Promise.all(rows.map(async row => ({
      ...row,
      discordUser: await resolveDiscordUser(interaction.client, row.user_id)
    })));
    const buffer = await drawLeaderboard(entries, scope);
    const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
    await interaction.editReply({ files: [attachment] });
  }
};

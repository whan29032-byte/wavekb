'use strict';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getCardData } = require('../profile');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('档案')
    .setDescription('查看科学侧或魔法侧档案')
    .addUserOption(option =>
      option
        .setName('用户')
        .setDescription('查看指定用户的档案')
        .setRequired(false)
    ),

  async execute(interaction, { database, drawCard }) {
    await interaction.deferReply();
    const targetUser = interaction.options.getUser('用户') || interaction.user;
    const storedUser = database.getUser(interaction.guildId, targetUser.id);

    if (!storedUser) {
      await interaction.editReply('该用户还没有档案，在服务器发送消息后即可自动创建。');
      return;
    }

    const user = {
      ...storedUser,
      rank: database.getRank(interaction.guildId, targetUser.id)
    };
    const cardData = getCardData(user);
    const buffer = await drawCard(user, cardData, targetUser);
    const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
    await interaction.editReply({ files: [attachment] });
  }
};

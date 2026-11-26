'use strict';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('设置档案')
    .setDescription('设置能力或术式名称，以及发动词或咏唱')
    .addStringOption(option =>
      option
        .setName('名称')
        .setDescription('能力名称或术式名（最多 20 字）')
        .setRequired(true)
        .setMaxLength(20)
    )
    .addStringOption(option =>
      option
        .setName('咏唱')
        .setDescription('发动词或咏唱（最多 40 字）')
        .setRequired(true)
        .setMaxLength(40)
    ),

  async execute(interaction, { database }) {
    const abilityName = interaction.options.getString('名称');
    const chant = interaction.options.getString('咏唱');
    const user = database.updateProfile(
      interaction.guildId,
      interaction.user.id,
      { abilityName, chant }
    );
    const nameLabel = user.path === 'esper' ? '能力名称' : '术式名';
    const chantLabel = user.path === 'esper' ? '发动词' : '咏唱';

    await interaction.reply({
      content: `设置成功！\n${nameLabel}：**${abilityName}**\n${chantLabel}：**${chant}**`,
      ephemeral: true
    });
  }
};

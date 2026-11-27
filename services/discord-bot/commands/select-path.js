'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { handlePathSelection } = require('../path-selection');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('选择路线')
    .setDescription('在科学侧能力者与魔法侧魔法师之间选择路线')
    .addStringOption(option =>
      option
        .setName('路线')
        .setDescription('选择档案路线')
        .setRequired(true)
        .addChoices(
          { name: '科学侧能力者（学园都市）', value: 'esper' },
          { name: '魔法侧魔法师', value: 'magician' }
        )
    ),

  async execute(interaction, {
    database,
    syncRouteRole = async () => ({ status: 'skipped' }),
    syncGrowthRole = async () => ({ status: 'skipped' })
  }) {
    const newPath = interaction.options.getString('路线');
    await handlePathSelection(interaction, newPath, {
      database,
      syncRouteRole,
      syncGrowthRole
    });
  }
};

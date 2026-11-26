'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { currentGamePath, executeGameAction, sendGameReply } = require('../game-actions');
const { points, rarityInfo } = require('../game-presenter');

const eggLabels = {
  basic: '普通宠物蛋',
  route: '阵营宠物蛋',
  premium: '幻想宠物蛋',
  route_esper: '科学侧阵营宠物蛋',
  route_magician: '魔法侧阵营宠物蛋'
};

function petLine(pet, includeId = false) {
  const rarity = rarityInfo(pet?.rarity);
  const name = String(pet?.nickname || pet?.name || '未命名宠物');
  const active = pet?.active ? ' · **出战中**' : '';
  const id = includeId && pet?.id ? `\n└ ID：\`${pet.id}\`` : '';
  return `${String(pet?.emoji || '🐾')} **${name}**〔${rarity.label}〕${active}${id}`;
}

function baseEmbed(title) {
  return new EmbedBuilder().setColor(0xf48fb1).setTitle(`🐾 ${title}`);
}

function actionFor(subcommand) {
  return ({
    商店: 'pet_shop',
    领养: 'pet_adopt',
    购买: 'pet_buy_egg',
    孵化: 'pet_hatch',
    我的: 'pet_list',
    改名: 'pet_rename',
    出战: 'pet_activate'
  })[subcommand];
}

const data = new SlashCommandBuilder()
  .setName('宠物')
  .setDescription('领养、购买、孵化和管理幻想宠物')
  .addSubcommand(command => command.setName('商店').setDescription('查看宠物蛋价格'))
  .addSubcommand(command => command.setName('领养').setDescription('使用每日一次的免费领养机会'))
  .addSubcommand(command => command
    .setName('购买')
    .setDescription('使用网站积分购买宠物蛋')
    .addStringOption(option => option.setName('蛋').setDescription('宠物蛋类型').setRequired(true).addChoices(
      { name: '普通宠物蛋（150）', value: 'basic' },
      { name: '阵营宠物蛋（350）', value: 'route' },
      { name: '幻想宠物蛋（700）', value: 'premium' }
    ))
    .addIntegerOption(option => option.setName('数量').setDescription('购买 1–10 枚').setRequired(true).setMinValue(1).setMaxValue(10)))
  .addSubcommand(command => command
    .setName('孵化')
    .setDescription('孵化已拥有的宠物蛋')
    .addStringOption(option => option.setName('蛋').setDescription('宠物蛋类型').setRequired(true).addChoices(
      { name: '普通宠物蛋', value: 'basic' },
      { name: '阵营宠物蛋', value: 'route' },
      { name: '幻想宠物蛋', value: 'premium' }
    ))
    .addIntegerOption(option => option.setName('数量').setDescription('孵化 1–10 枚').setRequired(true).setMinValue(1).setMaxValue(10)))
  .addSubcommand(command => command
    .setName('我的')
    .setDescription('分页查看宠物、宠物蛋和宠物 ID')
    .addIntegerOption(option => option
      .setName('页码')
      .setDescription('每页最多 25 只宠物')
      .setRequired(false)
      .setMinValue(1)))
  .addSubcommand(command => command
    .setName('改名')
    .setDescription('为自己的宠物改名')
    .addStringOption(option => option.setName('宠物id').setDescription('从“宠物 我的”复制 ID').setRequired(true))
    .addStringOption(option => option.setName('名称').setDescription('1–16 个字符').setRequired(true).setMinLength(1).setMaxLength(16)))
  .addSubcommand(command => command
    .setName('出战')
    .setDescription('选择一只宠物作为当前出战宠物')
    .addStringOption(option => option.setName('宠物id').setDescription('从“宠物 我的”复制 ID').setRequired(true)))
  .setDMPermission(false);

module.exports = {
  data,

  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    const action = actionFor(subcommand);
    const path = currentGamePath(interaction, context);
    let payload = {};
    if (subcommand === '领养') payload = { path };
    if (subcommand === '购买' || subcommand === '孵化') {
      payload = {
        eggType: interaction.options.getString('蛋', true),
        quantity: interaction.options.getInteger('数量', true),
        path
      };
    }
    if (subcommand === '改名') {
      payload = {
        petId: interaction.options.getString('宠物id', true),
        name: interaction.options.getString('名称', true).trim()
      };
    }
    if (subcommand === '出战') {
      payload = { petId: interaction.options.getString('宠物id', true) };
    }
    if (subcommand === '我的') {
      payload = { page: interaction.options.getInteger('页码') || 1 };
    }
    const isPublic = subcommand === '领养' || subcommand === '孵化';
    const result = await executeGameAction(interaction, context, action, payload);
    if (!result) return;

    let embed;
    if (subcommand === '商店') {
      const eggs = Array.isArray(result.eggs) ? result.eggs : [];
      embed = baseEmbed('宠物蛋商店')
        .setDescription(eggs.map(egg => `🥚 **${eggLabels[egg.type] || egg.name}** — ${points(egg.price)}`).join('\n'))
        .addFields({ name: '网站积分余额', value: points(result.balance) });
    } else if (subcommand === '领养') {
      embed = baseEmbed('今日领养成功').setDescription(petLine(result.pet));
    } else if (subcommand === '购买') {
      embed = baseEmbed('购买成功')
        .setDescription(`已购买 **${result.quantity}** 枚${eggLabels[result.eggType] || '宠物蛋'}，消耗 **${points(result.cost)}**。`)
        .addFields(
          { name: '当前库存', value: `${result.eggs} 枚`, inline: true },
          { name: '积分余额', value: points(result.balance), inline: true }
        );
    } else if (subcommand === '孵化') {
      const pets = Array.isArray(result.pets) ? result.pets : [];
      embed = baseEmbed('宠物蛋孵化结果')
        .setDescription(pets.map(item => petLine(item)).join('\n') || '没有返回孵化结果。')
        .addFields({ name: '该类蛋剩余', value: `${result.eggsRemaining} 枚` });
    } else if (subcommand === '我的') {
      const pets = Array.isArray(result.pets) ? result.pets : [];
      const eggEntries = result.eggs && typeof result.eggs === 'object'
        ? Object.entries(result.eggs)
        : [];
      embed = baseEmbed('我的宠物')
        .setDescription(pets.slice(0, 25).map(item => petLine(item, true)).join('\n') || '还没有宠物，先使用 **/宠物 领养** 吧。')
        .setFooter({ text: `第 ${result.page || 1}/${result.totalPages || 1} 页 · 共 ${result.total || pets.length} 只` })
        .addFields({
          name: '宠物蛋库存',
          value: eggEntries.length
            ? eggEntries.map(([key, quantity]) => `${eggLabels[key] || key} ×${quantity}`).join('\n')
            : '暂无宠物蛋'
        });
    } else if (subcommand === '改名') {
      embed = baseEmbed('改名成功').setDescription(`宠物的新名字是 **${result.name}**。`);
    } else {
      embed = baseEmbed('出战宠物已更新').setDescription(`宠物 \`${result.petId}\` 现在处于出战状态。`);
    }
    await sendGameReply(interaction, { embeds: [embed] }, { public: isPublic });
  }
};

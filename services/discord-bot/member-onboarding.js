'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const PATH_BUTTON_PREFIX = 'onboarding:path:';
const PATHS = new Set(['esper', 'magician']);

function buildMemberWelcome(member) {
  const embed = new EmbedBuilder()
    .setColor(0x55c7f3)
    .setTitle('📜 新人入学登记')
    .setDescription([
      '这里是科学侧与魔法侧并存的「悠の学园都市」。',
      '',
      '请先选择阵营，机器人会为你建立档案并同步对应身份。两个阵营权限完全相同，之后仍可使用 `/选择路线` 查看切换规则。'
    ].join('\n'))
    .setFooter({ text: '悠の学园都市 · 欢迎新成员' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PATH_BUTTON_PREFIX}esper`)
      .setLabel('加入科学侧')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PATH_BUTTON_PREFIX}magician`)
      .setLabel('加入魔法侧')
      .setEmoji('✨')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content: `${member}，欢迎加入「悠の学园都市」！`,
    embeds: [embed],
    components: [row],
    allowedMentions: {
      parse: [],
      users: [member.id]
    }
  };
}

function parsePathButton(customId) {
  if (typeof customId !== 'string' || !customId.startsWith(PATH_BUTTON_PREFIX)) {
    return null;
  }
  const path = customId.slice(PATH_BUTTON_PREFIX.length);
  return PATHS.has(path) ? path : null;
}

module.exports = { buildMemberWelcome, parsePathButton };

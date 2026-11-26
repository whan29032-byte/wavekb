'use strict';

const { PermissionFlagsBits } = require('discord.js');

const GUILD_ONLY_MESSAGE = '此命令只能在已配置的 Discord 服务器中使用。';
const EMBED_LINKS_REQUIRED_MESSAGE = '机器人在当前频道缺少 **Embed Links（嵌入链接）** 权限，本次操作尚未执行。请联系服务器管理员开启后重试。';
const EMBED_LINKS_RESULT_HIDDEN_MESSAGE = '本次操作已经完成，但机器人因缺少 **Embed Links（嵌入链接）** 权限而无法显示结果。请勿重复操作；请联系服务器管理员开启权限后查询余额、图鉴或宠物列表。';

function lacksEmbedLinks(interaction) {
  return Boolean(
    interaction.appPermissions &&
    !interaction.appPermissions.has(PermissionFlagsBits.EmbedLinks)
  );
}

function gameErrorMessage(error) {
  const messages = {
    not_linked: '你还没有绑定 WaveKB，请先运行 **/绑定网站** 获取一次性绑定链接。',
    account_restricted: '已绑定的 WaveKB 账号当前受限，暂时不能使用积分玩法。',
    insufficient_points: '网站积分不足，先签到、打工或参与社区活动再来试试吧。',
    work_cooldown: '打工仍在冷却中，每 4 小时可以进行一次。',
    work_daily_limit: '今天已经打工 4 次，明天再来吧。',
    pet_adoption_already_used: '今天的免费宠物领养机会已经使用。',
    pet_egg_insufficient: '对应宠物蛋数量不足，请先购买。',
    pet_not_found: '没有找到这只宠物，请重新查看你的宠物列表。',
    market_closed: '今日虚拟行情已经停止下注，请等待结算。',
    market_daily_limit: '今日押注总额已达到 500 积分上限。',
    request_id_conflict: '这次交互已被处理，请重新运行命令。',
    website_not_configured: '网站积分接入尚未配置，请联系服务器管理员。'
  };
  return messages[error?.code] || 'WaveKB 暂时无法连接，结果暂时无法确认。系统已用同一请求编号重试；请先查看余额、图鉴或宠物列表，再决定是否重新操作。';
}

async function executeGameAction(
  interaction,
  { websiteClient, websiteGuildId },
  action,
  payload = {}
) {
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.guildId || (websiteGuildId && interaction.guildId !== websiteGuildId)) {
    await interaction.editReply({ content: GUILD_ONLY_MESSAGE });
    return null;
  }
  if (lacksEmbedLinks(interaction)) {
    await interaction.editReply({ content: EMBED_LINKS_REQUIRED_MESSAGE });
    return null;
  }
  try {
    return await websiteClient.gameAction({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      requestId: interaction.id,
      action,
      payload
    });
  } catch (error) {
    await interaction.editReply({ content: gameErrorMessage(error) });
    return null;
  }
}

async function sendGameReply(interaction, response, { public: publicSuccess = false } = {}) {
  if (
    Array.isArray(response?.embeds) && response.embeds.length > 0 &&
    lacksEmbedLinks(interaction)
  ) {
    await interaction.editReply({
      content: EMBED_LINKS_RESULT_HIDDEN_MESSAGE
    });
    return;
  }
  if (!publicSuccess) {
    await interaction.editReply(response);
    return;
  }
  await interaction.followUp({ ...response, ephemeral: false });
  await interaction.deleteReply();
}

function currentGamePath(interaction, { database }) {
  const profile = database.getOrCreateUser(interaction.guildId, interaction.user.id);
  return profile.path === 'magician' ? 'magician' : 'esper';
}

module.exports = {
  GUILD_ONLY_MESSAGE,
  currentGamePath,
  executeGameAction,
  gameErrorMessage,
  sendGameReply
};

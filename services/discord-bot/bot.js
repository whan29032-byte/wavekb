'use strict';

const path = require('node:path');
const { Client, Events, GatewayIntentBits } = require('discord.js');
const { loadCommands } = require('./command-loader');
const { drawCard: renderCard } = require('./canvas');
const { drawLeaderboard: renderLeaderboard } = require('./leaderboard-canvas');
const { getCardData } = require('./profile');
const { handlePathSelection } = require('./path-selection');
const { buildMemberWelcome, parsePathButton } = require('./member-onboarding');
const { configureProxy, applyRestAgent, fetchImageBuffer } = require('./network');
const { syncRouteRole: syncConfiguredRouteRole } = require('./route-role-sync');
const { syncGrowthRole: syncConfiguredGrowthRole } = require('./growth-role-sync');
const { createWebsiteClient } = require('./website-client');
const { syncWebsiteRoles: syncConfiguredWebsiteRoles } = require('./website-role-sync');

function randomXp(rng) {
  return Math.floor(rng() * 11) + 5;
}

function shutdownBot(client, database) {
  try {
    database.close();
  } finally {
    client.destroy();
  }
}

function createBot({
  config,
  database,
  commands = loadCommands(path.resolve(__dirname, 'commands')).collection,
  rng = Math.random,
  logger = console,
  clientFactory = options => new Client(options),
  drawCard = renderCard,
  drawLeaderboard = renderLeaderboard,
  imageFetcher = fetchImageBuffer,
  networkFactory = configureProxy,
  routeRoleSync = syncConfiguredRouteRole,
  growthRoleSync = syncConfiguredGrowthRole,
  websiteClientFactory = createWebsiteClient,
  websiteRoleSync = syncConfiguredWebsiteRoles
}) {
  const { restAgent } = networkFactory(config.proxyUrl);
  const client = clientFactory({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers
    ]
  });
  applyRestAgent(client.rest, restAgent);
  const websiteIntegration = config.websiteIntegration || null;
  const websiteClient = websiteClientFactory({
    integration: websiteIntegration,
    dispatcher: restAgent
  });
  const avatarFetcher = url => imageFetcher(url, restAgent);
  const drawProfileCard = (user, cardData, discordUser) => drawCard(
    user,
    cardData,
    discordUser,
    {
      backgroundPaths: config.backgroundPaths,
      avatarFetcher
    }
  );
  const drawLeaderboardImage = (entries, scope) => drawLeaderboard(
    entries,
    scope,
    {
      backgroundPaths: config.backgroundPaths,
      avatarFetcher
    }
  );
  const boundRouteRoleSync = input => routeRoleSync({
    ...input,
    routeRoles: config.routeRoles || null
  });
  const boundGrowthRoleSync = input => growthRoleSync({
    ...input,
    growthRoles: config.growthRoles || null
  });
  const boundWebsiteRoleSync = input => websiteRoleSync({
    ...input,
    integration: websiteIntegration
  });

  client.once(Events.ClientReady, readyClient => {
    logger.log(`${readyClient.user.tag} 已上线`);
  });

  client.on(Events.Error, error => {
    logger.error('Discord 客户端错误', error);
  });

  client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isButton?.()) {
      const selectedPath = parsePathButton(interaction.customId);
      if (!selectedPath) return;

      try {
        await interaction.deferReply({ ephemeral: true });
        await handlePathSelection(interaction, selectedPath, {
          database,
          syncRouteRole: boundRouteRoleSync,
          syncGrowthRole: boundGrowthRoleSync
        }, { successEphemeral: true });
      } catch (error) {
        logger.error('阵营按钮处理失败', error);
        const response = {
          content: '选择阵营时发生错误，请稍后再试。'
        };
        try {
          if (interaction.deferred) {
            await interaction.editReply(response);
          } else if (interaction.replied) {
            await interaction.followUp({ ...response, ephemeral: true });
          } else {
            await interaction.reply({ ...response, ephemeral: true });
          }
        } catch (replyError) {
          logger.error('阵营按钮错误回复失败', replyError);
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, {
        database,
        syncRouteRole: boundRouteRoleSync,
        syncGrowthRole: boundGrowthRoleSync,
        websiteClient,
        websiteGuildId: websiteIntegration?.guildId || null,
        syncWebsiteRoles: boundWebsiteRoleSync,
        drawCard: drawProfileCard,
        drawLeaderboard: drawLeaderboardImage
      });
    } catch (error) {
      logger.error('命令执行失败', error);
      const response = {
        content: '执行命令时发生错误，请稍后再试。',
        ephemeral: true
      };
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(response);
        } else {
          await interaction.reply(response);
        }
      } catch (replyError) {
        logger.error('命令错误回复失败', replyError);
      }
    }
  });

  client.on(Events.GuildMemberAdd, async member => {
    if (member.user.bot || !config.welcomeChannelId) return;

    try {
      const channel = await member.guild.channels.fetch(config.welcomeChannelId);
      if (!channel?.isTextBased() || typeof channel.send !== 'function') {
        throw new Error('欢迎频道不可发送消息');
      }
      await channel.send(buildMemberWelcome(member));
    } catch (error) {
      logger.warn('新人欢迎发送失败', error);
    }
  });

  client.on(Events.MessageCreate, async message => {
    if (
      message.author.bot ||
      !message.guild ||
      message.webhookId ||
      message.system
    ) {
      return;
    }

    try {
      const result = database.awardMessageXp(
        message.guild.id,
        message.author.id,
        randomXp(rng),
        Date.now()
      );
      if (!result.awarded) return;

      try {
        const syncResult = await boundGrowthRoleSync({
          member: message.member,
          guildId: message.guild.id,
          path: result.user.path,
          level: result.user.level
        });
        if (syncResult.status === 'failed') {
          logger.warn('成长角色同步失败', syncResult.reason);
        }
      } catch (error) {
        logger.warn('成长角色同步失败', error);
      }

      if (result.levelsGained === 0) return;

      const notificationContent =
        `${message.author} 升级了！当前等级 **Lv.${result.user.level}**`;
      let notification = notificationContent;

      try {
        const user = {
          ...result.user,
          rank: database.getRank(message.guild.id, message.author.id)
        };
        const buffer = await drawProfileCard(user, getCardData(user), message.author);
        notification = {
          content: notificationContent,
          files: [{ attachment: buffer, name: 'level-up.png' }]
        };
      } catch (error) {
        logger.warn('升级图片生成失败', error);
      }

      try {
        await message.channel.send(notification);
      } catch (error) {
        logger.warn('升级通知发送失败', error);
      }
    } catch (error) {
      logger.error('消息处理失败', error);
    }
  });

  return client;
}

module.exports = { createBot, shutdownBot };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, Events, GatewayIntentBits, Routes } = require('discord.js');

const { createBot, shutdownBot } = require('../bot');
const { deployCommands, configureRestProxy } = require('../deploy-commands');
const { createDatabase } = require('../database');

class FakeClient {
  constructor(options) {
    this.options = options;
    this.handlers = new Map();
    this.user = { tag: '悠悠的宝宝#0001' };
    this.destroyed = false;
    this.restAgents = [];
    this.rest = {
      setAgent: agent => {
        this.restAgents.push(agent);
        return this.rest;
      }
    };
  }

  on(event, handler) {
    this.handlers.set(event, handler);
    return this;
  }

  once(event, handler) {
    this.handlers.set(event, handler);
    return this;
  }

  destroy() {
    this.destroyed = true;
  }
}

function temporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-bot-event-'));
  const database = createDatabase(path.join(directory, 'profile.db'));
  t.after(() => {
    try {
      database.close();
    } catch {
      // A shutdown test may already have closed it.
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

function createTestBot(t, overrides = {}) {
  const database = overrides.database || temporaryDatabase(t);
  const client = new FakeClient();
  const commands = overrides.commands || new Collection();
  const logger = overrides.logger || { log() {}, error() {}, warn() {} };
  const bot = createBot({
    config: overrides.config || {
      backgroundPaths: { esper: 'esper.png', magician: 'magician.png' }
    },
    database,
    commands,
    rng: overrides.rng || (() => 0),
    logger,
    clientFactory(options) {
      client.options = options;
      return client;
    },
    drawCard: overrides.drawCard || (async () => Buffer.from('png')),
    drawLeaderboard: overrides.drawLeaderboard || (async () => Buffer.from('leaderboard')),
    imageFetcher: overrides.imageFetcher,
    networkFactory: overrides.networkFactory,
    routeRoleSync: overrides.routeRoleSync,
    growthRoleSync: overrides.growthRoleSync,
    websiteClientFactory: overrides.websiteClientFactory,
    websiteRoleSync: overrides.websiteRoleSync
  });
  return { bot, client, database };
}

function createMessage({ id = 'member', bot = false, guild = true, webhookId = null, system = false, member = null } = {}) {
  const sent = [];
  return {
    author: { id, bot, toString: () => `<@${id}>` },
    guild: guild ? { id: 'guild' } : null,
    member,
    webhookId,
    system,
    channel: {
      async send(content) {
        sent.push(content);
      }
    },
    sent
  };
}

test('createBot requests guild-member events without requesting message content', t => {
  const { client } = createTestBot(t);

  assert.deepEqual(client.options.intents, [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ]);
  assert.equal(client.options.intents.includes(GatewayIntentBits.MessageContent), false);
});

test('a human member join sends the themed welcome payload to the configured channel', async t => {
  const sent = [];
  const fetchedChannelIds = [];
  const { client } = createTestBot(t, {
    config: {
      welcomeChannelId: 'welcome-channel',
      backgroundPaths: { esper: 'esper.png', magician: 'magician.png' }
    }
  });
  const member = {
    id: 'new-member',
    user: { bot: false },
    toString: () => '<@new-member>',
    guild: {
      channels: {
        async fetch(channelId) {
          fetchedChannelIds.push(channelId);
          return {
            isTextBased: () => true,
            async send(payload) {
              sent.push(payload);
            }
          };
        }
      }
    }
  };

  await client.handlers.get(Events.GuildMemberAdd)(member);

  assert.deepEqual(fetchedChannelIds, ['welcome-channel']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, '<@new-member>，欢迎加入「悠の学园都市」！');
  assert.deepEqual(sent[0].allowedMentions, {
    parse: [],
    users: ['new-member']
  });
  assert.deepEqual(
    sent[0].components[0].toJSON().components.map(button => button.custom_id),
    ['onboarding:path:esper', 'onboarding:path:magician']
  );
});

test('a bot member join does not fetch or send to the welcome channel', async t => {
  let fetchCalls = 0;
  const { client } = createTestBot(t, {
    config: {
      welcomeChannelId: 'welcome-channel',
      backgroundPaths: { esper: 'esper.png', magician: 'magician.png' }
    }
  });
  const member = {
    id: 'bot-member',
    user: { bot: true },
    guild: {
      channels: {
        async fetch() {
          fetchCalls += 1;
        }
      }
    }
  };

  await client.handlers.get(Events.GuildMemberAdd)(member);

  assert.equal(fetchCalls, 0);
});

test('welcome send failures are logged without rejecting the member event', async t => {
  const warnings = [];
  const logger = {
    log() {},
    error() {},
    warn(...args) { warnings.push(args); }
  };
  const { client } = createTestBot(t, {
    logger,
    config: {
      welcomeChannelId: 'welcome-channel',
      backgroundPaths: { esper: 'esper.png', magician: 'magician.png' }
    }
  });
  const failure = new Error('missing permission');
  const member = {
    id: 'new-member',
    user: { bot: false },
    guild: {
      channels: {
        async fetch() {
          throw failure;
        }
      }
    }
  };

  await assert.doesNotReject(client.handlers.get(Events.GuildMemberAdd)(member));
  assert.deepEqual(warnings, [['新人欢迎发送失败', failure]]);
});

test('an onboarding path button selects the route and synchronizes member roles privately', async t => {
  const identityCalls = [];
  const growthCalls = [];
  const interactionEvents = [];
  const member = { id: 'new-member' };
  const { client, database } = createTestBot(t, {
    async routeRoleSync(input) {
      interactionEvents.push('identity-sync');
      identityCalls.push(input);
      return { status: 'synced' };
    },
    async growthRoleSync(input) {
      interactionEvents.push('growth-sync');
      growthCalls.push(input);
      return { status: 'synced' };
    }
  });
  const interaction = {
    customId: 'onboarding:path:magician',
    guildId: 'guild',
    user: { id: 'new-member' },
    member,
    deferred: false,
    replied: false,
    isButton: () => true,
    isChatInputCommand: () => false,
    async deferReply(payload) {
      interactionEvents.push(['defer', payload]);
      this.deferred = true;
    },
    async editReply(payload) {
      interactionEvents.push(['edit', payload]);
      this.replied = true;
    },
    async reply(payload) {
      interactionEvents.push(['reply', payload]);
      this.replied = true;
    }
  };

  await client.handlers.get(Events.InteractionCreate)(interaction);

  assert.equal(database.getUser('guild', 'new-member').path, 'magician');
  assert.equal(identityCalls[0].member, member);
  assert.equal(identityCalls[0].path, 'magician');
  assert.equal(growthCalls[0].path, 'magician');
  assert.equal(growthCalls[0].level, 1);
  assert.deepEqual(interactionEvents, [
    ['defer', { ephemeral: true }],
    'identity-sync',
    'growth-sync',
    ['edit', { content: '已切换为 **魔法侧魔法师** 路线。' }]
  ]);
});

test('onboarding button errors edit the already deferred private response', async t => {
  const failure = new Error('database unavailable');
  const errorLogs = [];
  const interactionEvents = [];
  const { client } = createTestBot(t, {
    database: {
      changePath() { throw failure; },
      close() {}
    },
    logger: {
      log() {},
      warn() {},
      error(...args) { errorLogs.push(args); }
    }
  });
  const interaction = {
    customId: 'onboarding:path:esper',
    guildId: 'guild',
    user: { id: 'new-member' },
    member: { id: 'new-member' },
    deferred: false,
    replied: false,
    isButton: () => true,
    isChatInputCommand: () => false,
    async deferReply(payload) {
      interactionEvents.push(['defer', payload]);
      this.deferred = true;
    },
    async editReply(payload) {
      interactionEvents.push(['edit', payload]);
      this.replied = true;
    },
    async reply(payload) {
      interactionEvents.push(['reply', payload]);
      this.replied = true;
    }
  };

  await client.handlers.get(Events.InteractionCreate)(interaction);

  assert.deepEqual(interactionEvents, [
    ['defer', { ephemeral: true }],
    ['edit', { content: '选择阵营时发生错误，请稍后再试。' }]
  ]);
  assert.deepEqual(errorLogs, [['阵营按钮处理失败', failure]]);
});

test('unknown buttons are ignored without creating a profile', async t => {
  const replies = [];
  const { client, database } = createTestBot(t);
  const interaction = {
    customId: 'another-feature:button',
    guildId: 'guild',
    user: { id: 'new-member' },
    member: { id: 'new-member' },
    isButton: () => true,
    isChatInputCommand: () => false,
    async reply(payload) { replies.push(payload); }
  };

  await client.handlers.get(Events.InteractionCreate)(interaction);

  assert.equal(database.getUser('guild', 'new-member'), undefined);
  assert.deepEqual(replies, []);
});

test('createBot injects a route-role synchronizer bound to configuration', async t => {
  const calls = [];
  const routeRoles = {
    guildId: 'guild-theme',
    esperRoleId: 'role-science',
    magicianRoleId: 'role-magic'
  };
  const commands = new Collection([
    ['route', {
      async execute(interaction, dependencies) {
        await dependencies.syncRouteRole({
          member: interaction.member,
          guildId: interaction.guildId,
          path: 'esper'
        });
      }
    }]
  ]);
  const member = { id: 'member' };
  const { client } = createTestBot(t, {
    commands,
    config: {
      routeRoles,
      backgroundPaths: { esper: 'esper.png', magician: 'magician.png' }
    },
    async routeRoleSync(input) {
      calls.push(input);
      return { status: 'synced' };
    }
  });

  await client.handlers.get(Events.InteractionCreate)({
    commandName: 'route',
    guildId: 'guild-theme',
    member,
    isChatInputCommand: () => true
  });

  assert.deepEqual(calls, [{
    member,
    guildId: 'guild-theme',
    path: 'esper',
    routeRoles
  }]);
  assert.deepEqual(client.options.intents, [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ]);
});

test('createBot applies proxy networking to REST and WebSocket setup', t => {
  const restAgent = { name: 'rest-proxy' };
  const calls = [];
  const { client } = createTestBot(t, {
    config: {
      proxyUrl: 'http://127.0.0.1:7897',
      backgroundPaths: { esper: 'esper.png', magician: 'magician.png' }
    },
    networkFactory(proxyUrl) {
      calls.push(proxyUrl);
      return { restAgent, websocketAgent: { name: 'ws-proxy' } };
    }
  });

  assert.deepEqual(calls, ['http://127.0.0.1:7897']);
  assert.deepEqual(client.restAgents, [restAgent]);
});

test('createBot binds profile avatar downloads to the REST proxy dispatcher', async t => {
  const restAgent = { name: 'rest-proxy' };
  const imageFetches = [];
  const replies = [];
  const commands = new Collection([
    ['card', {
      async execute(interaction, dependencies) {
        await dependencies.drawCard({}, {}, {});
      }
    }]
  ]);
  const { client } = createTestBot(t, {
    commands,
    networkFactory() {
      return { restAgent, websocketAgent: null };
    },
    async imageFetcher(url, dispatcher) {
      imageFetches.push({ url, dispatcher });
      return Buffer.from('avatar-bytes');
    },
    async drawCard(user, cardData, discordUser, options) {
      const bytes = await options.avatarFetcher('https://cdn.discordapp.com/avatar.png');
      assert.deepEqual(bytes, Buffer.from('avatar-bytes'));
      return Buffer.from('card');
    }
  });

  await client.handlers.get(Events.InteractionCreate)({
    commandName: 'card',
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    async reply(payload) { replies.push(payload); }
  });

  assert.deepEqual(imageFetches, [{
    url: 'https://cdn.discordapp.com/avatar.png',
    dispatcher: restAgent
  }]);
  assert.deepEqual(replies, []);
});

test('createBot binds leaderboard avatar downloads to the REST proxy dispatcher', async t => {
  const restAgent = { name: 'rest-proxy' };
  const imageFetches = [];
  const replies = [];
  const drawCalls = [];
  const commands = new Collection([
    ['leaderboard-wire', {
      async execute(interaction, dependencies) {
        await dependencies.drawLeaderboard([{ user_id: 'member' }], 'all');
      }
    }]
  ]);
  const { client } = createTestBot(t, {
    commands,
    networkFactory() {
      return { restAgent, websocketAgent: null };
    },
    async imageFetcher(url, dispatcher) {
      imageFetches.push({ url, dispatcher });
      return Buffer.from('avatar-bytes');
    },
    async drawLeaderboard(entries, scope, options) {
      const bytes = await options.avatarFetcher('https://cdn.discordapp.com/rank.png');
      drawCalls.push({ entries, scope, backgroundPaths: options.backgroundPaths, bytes });
      return Buffer.from('board');
    }
  });

  await client.handlers.get(Events.InteractionCreate)({
    commandName: 'leaderboard-wire',
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    async reply(payload) { replies.push(payload); }
  });

  assert.deepEqual(imageFetches, [{
    url: 'https://cdn.discordapp.com/rank.png',
    dispatcher: restAgent
  }]);
  assert.deepEqual(drawCalls, [{
    entries: [{ user_id: 'member' }],
    scope: 'all',
    backgroundPaths: { esper: 'esper.png', magician: 'magician.png' },
    bytes: Buffer.from('avatar-bytes')
  }]);
  assert.deepEqual(replies, []);
});

test('createBot binds the website client to the REST dispatcher and injects allowlisted role sync', async t => {
  const restAgent = { name: 'rest-proxy' };
  const integration = {
    apiUrl: 'https://wavekb.com',
    publicUrl: 'https://wavekb.com',
    apiSecret: 'website-bot-secret-that-is-at-least-32-bytes',
    guildId: '1545731927733047306',
    linkedRoleId: '1545731927733047307',
    titleRoleMap: {}
  };
  const websiteClient = { name: 'website-client' };
  const factoryCalls = [];
  const roleCalls = [];
  const commandCalls = [];
  const commandGuildIds = [];
  const commands = new Collection([['website-wire', {
    async execute(interaction, dependencies) {
      commandCalls.push(dependencies.websiteClient);
      commandGuildIds.push(dependencies.websiteGuildId);
      await dependencies.syncWebsiteRoles({
        member: interaction.member,
        guildId: interaction.guildId,
        profile: { displayTitle: null }
      });
    }
  }]]);
  const { client } = createTestBot(t, {
    commands,
    config: {
      proxyUrl: 'http://127.0.0.1:7897',
      websiteIntegration: integration,
      backgroundPaths: { esper: 'esper.png', magician: 'magician.png' }
    },
    networkFactory() { return { restAgent, websocketAgent: null }; },
    websiteClientFactory(input) {
      factoryCalls.push(input);
      return websiteClient;
    },
    async websiteRoleSync(input) {
      roleCalls.push(input);
      return { status: 'already_synced', addedRoleIds: [], removedRoleIds: [] };
    }
  });
  const member = { id: 'member' };

  await client.handlers.get(Events.InteractionCreate)({
    commandName: 'website-wire',
    guildId: integration.guildId,
    member,
    deferred: false,
    replied: false,
    isButton: () => false,
    isChatInputCommand: () => true
  });

  assert.deepEqual(factoryCalls, [{ integration, dispatcher: restAgent }]);
  assert.deepEqual(commandCalls, [websiteClient]);
  assert.deepEqual(commandGuildIds, [integration.guildId]);
  assert.deepEqual(roleCalls, [{
    member,
    guildId: integration.guildId,
    profile: { displayTitle: null },
    integration
  }]);
});

test('message handler ignores bots, direct messages, webhooks, and system messages', async t => {
  const { client, database } = createTestBot(t);
  const handler = client.handlers.get('messageCreate');

  await handler(createMessage({ id: 'bot', bot: true }));
  await handler(createMessage({ id: 'direct', guild: false }));
  await handler(createMessage({ id: 'webhook', webhookId: 'hook' }));
  await handler(createMessage({ id: 'system', system: true }));

  assert.equal(database.getUser('guild', 'bot'), undefined);
  assert.equal(database.getUser('guild', 'direct'), undefined);
  assert.equal(database.getUser('guild', 'webhook'), undefined);
  assert.equal(database.getUser('guild', 'system'), undefined);
});

test('eligible messages award an injected random amount without announcing a normal gain', async t => {
  const { client, database } = createTestBot(t, { rng: () => 0.9999 });
  const message = createMessage({ id: 'member' });

  await client.handlers.get('messageCreate')(message);

  const user = database.getUser('guild', 'member');
  assert.equal(user.total_xp, 15);
  assert.equal(user.xp, 15);
  assert.deepEqual(message.sent, []);
});

test('every eligible message synchronizes the current route growth role without waiting for a level-up', async t => {
  const calls = [];
  const growthRoles = {
    guildId: 'guild',
    esperRoleIds: ['s0', 's1', 's2', 's3', 's4', 's5'],
    magicianRoleIds: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']
  };
  const member = { id: 'member' };
  const { client } = createTestBot(t, {
    config: {
      growthRoles,
      backgroundPaths: { esper: 'esper.png', magician: 'magician.png' }
    },
    async growthRoleSync(input) {
      calls.push(input);
      return { status: 'synced' };
    }
  });

  await client.handlers.get(Events.MessageCreate)(createMessage({ member }));

  assert.deepEqual(calls, [{
    member,
    guildId: 'guild',
    path: 'esper',
    level: 1,
    growthRoles
  }]);
});

test('message handler announces a level with a rendered profile image', async t => {
  const restAgent = { name: 'rest-proxy' };
  const imageFetches = [];
  const drawCalls = [];
  const database = temporaryDatabase(t);
  database.awardMessageXp('guild', 'leveler', 95, 1);
  const { client } = createTestBot(t, {
    database,
    rng: () => 0,
    networkFactory() {
      return { restAgent, websocketAgent: null };
    },
    async imageFetcher(url, dispatcher) {
      imageFetches.push({ url, dispatcher });
      return Buffer.from('avatar-bytes');
    },
    async drawCard(user, cardData, discordUser, options) {
      drawCalls.push({ user, cardData, discordUser });
      const avatar = await options.avatarFetcher(
        'https://cdn.discordapp.com/avatars/leveler/avatar.png'
      );
      return Buffer.concat([Buffer.from('level-up:'), avatar]);
    }
  });
  const message = createMessage({ id: 'leveler' });

  await client.handlers.get('messageCreate')(message);

  assert.equal(database.getUser('guild', 'leveler').level, 2);
  assert.equal(message.sent.length, 1);
  assert.equal(message.sent[0].content, '<@leveler> 升级了！当前等级 **Lv.2**');
  assert.equal(message.sent[0].files.length, 1);
  assert.equal(message.sent[0].files[0].name, 'level-up.png');
  assert.deepEqual(
    message.sent[0].files[0].attachment,
    Buffer.from('level-up:avatar-bytes')
  );
  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0].user.level, 2);
  assert.equal(drawCalls[0].user.rank, 1);
  assert.equal(drawCalls[0].cardData.titleText, '低阶能力者');
  assert.equal(drawCalls[0].discordUser, message.author);
  assert.deepEqual(imageFetches, [{
    url: 'https://cdn.discordapp.com/avatars/leveler/avatar.png',
    dispatcher: restAgent
  }]);
});

test('level-up notification falls back to text when image rendering fails', async t => {
  const warnings = [];
  const logger = {
    log() {},
    error() {},
    warn(...args) { warnings.push(args); }
  };
  const database = temporaryDatabase(t);
  database.awardMessageXp('guild', 'leveler', 95, 1);
  const { client } = createTestBot(t, {
    database,
    logger,
    rng: () => 0,
    async drawCard() { throw new Error('render failed'); }
  });
  const message = createMessage({ id: 'leveler' });

  await client.handlers.get('messageCreate')(message);

  assert.deepEqual(message.sent, ['<@leveler> 升级了！当前等级 **Lv.2**']);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '升级图片生成失败');
});

test('message growth synchronization uses the level after experience is awarded', async t => {
  const database = temporaryDatabase(t);
  database.awardMessageXp('guild', 'leveler', 95, 1);
  const calls = [];
  const member = { id: 'leveler' };
  const { client } = createTestBot(t, {
    database,
    rng: () => 0,
    config: {
      growthRoles: {
        guildId: 'guild',
        esperRoleIds: ['s0', 's1', 's2', 's3', 's4', 's5'],
        magicianRoleIds: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']
      },
      backgroundPaths: { esper: 'esper.png', magician: 'magician.png' }
    },
    async growthRoleSync(input) {
      calls.push(input);
      return { status: 'synced' };
    }
  });

  await client.handlers.get(Events.MessageCreate)(createMessage({ id: 'leveler', member }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].level, 2);
  assert.equal(calls[0].path, 'esper');
});

test('command errors reply directly when the interaction has not responded', async t => {
  const commands = new Collection([
    ['broken', { async execute() { throw new Error('boom'); } }]
  ]);
  const { client } = createTestBot(t, { commands });
  const replies = [];
  const interaction = {
    commandName: 'broken',
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    async reply(payload) { replies.push(payload); }
  };

  await client.handlers.get('interactionCreate')(interaction);

  assert.deepEqual(replies, [{
    content: '执行命令时发生错误，请稍后再试。',
    ephemeral: true
  }]);
});

test('command errors follow up when the interaction was already deferred', async t => {
  const commands = new Collection([
    ['broken', { async execute() { throw new Error('boom'); } }]
  ]);
  const { client } = createTestBot(t, { commands });
  const followUps = [];
  const interaction = {
    commandName: 'broken',
    deferred: true,
    replied: false,
    isChatInputCommand: () => true,
    async followUp(payload) { followUps.push(payload); }
  };

  await client.handlers.get('interactionCreate')(interaction);

  assert.deepEqual(followUps, [{
    content: '执行命令时发生错误，请稍后再试。',
    ephemeral: true
  }]);
});

test('message database failures are logged without rejecting the event handler', async t => {
  const errors = [];
  const database = {
    awardMessageXp() {
      throw new Error('database unavailable');
    },
    close() {}
  };
  const logger = {
    log() {},
    warn() {},
    error(...args) { errors.push(args); }
  };
  const { client } = createTestBot(t, { database, logger });

  await assert.doesNotReject(
    client.handlers.get(Events.MessageCreate)(createMessage())
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], '消息处理失败');
  assert.match(errors[0][1].message, /database unavailable/);
});

test('failed command error replies are logged without rejecting the event handler', async t => {
  const errors = [];
  const commands = new Collection([
    ['broken', { async execute() { throw new Error('command failed'); } }]
  ]);
  const logger = {
    log() {},
    warn() {},
    error(...args) { errors.push(args); }
  };
  const { client } = createTestBot(t, { commands, logger });
  const interaction = {
    commandName: 'broken',
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    async reply() { throw new Error('reply failed'); }
  };

  await assert.doesNotReject(
    client.handlers.get(Events.InteractionCreate)(interaction)
  );
  assert.deepEqual(errors.map(entry => entry[0]), [
    '命令执行失败',
    '命令错误回复失败'
  ]);
});

test('failed command error follow-ups are logged without rejecting the event handler', async t => {
  const errors = [];
  const commands = new Collection([
    ['broken', { async execute() { throw new Error('command failed'); } }]
  ]);
  const logger = {
    log() {},
    warn() {},
    error(...args) { errors.push(args); }
  };
  const { client } = createTestBot(t, { commands, logger });
  const interaction = {
    commandName: 'broken',
    deferred: true,
    replied: false,
    isChatInputCommand: () => true,
    async followUp() { throw new Error('follow-up failed'); }
  };

  await assert.doesNotReject(
    client.handlers.get(Events.InteractionCreate)(interaction)
  );
  assert.deepEqual(errors.map(entry => entry[0]), [
    '命令执行失败',
    '命令错误回复失败'
  ]);
});

test('failed level-up notifications are logged without rejecting the event handler', async t => {
  const warnings = [];
  const logger = {
    log() {},
    error() {},
    warn(...args) { warnings.push(args); }
  };
  const database = temporaryDatabase(t);
  database.awardMessageXp('guild', 'leveler', 95, 1);
  const { client } = createTestBot(t, { database, logger, rng: () => 0 });
  const message = createMessage({ id: 'leveler' });
  message.channel.send = async () => {
    throw new Error('missing permission');
  };

  await assert.doesNotReject(
    client.handlers.get(Events.MessageCreate)(message)
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '升级通知发送失败');
});

test('Discord client errors are handled and logged', t => {
  const errors = [];
  const logger = {
    log() {},
    warn() {},
    error(...args) { errors.push(args); }
  };
  const { client } = createTestBot(t, { logger });
  const failure = new Error('gateway failed');

  client.handlers.get(Events.Error)(failure);

  assert.deepEqual(errors, [['Discord 客户端错误', failure]]);
});

test('deployCommands uses a guild route when GUILD_ID is configured', async () => {
  const calls = [];
  const rest = {
    async put(route, payload) {
      calls.push({ route, payload });
    }
  };
  const commands = [{ name: '档案' }];

  await deployCommands({
    config: { clientId: 'client', guildId: 'guild' },
    commands,
    rest
  });

  assert.deepEqual(calls, [{
    route: Routes.applicationGuildCommands('client', 'guild'),
    payload: { body: commands }
  }]);
});

test('deployCommands uses the global route when GUILD_ID is absent', async () => {
  const calls = [];
  const rest = {
    async put(route, payload) {
      calls.push({ route, payload });
    }
  };

  await deployCommands({
    config: { clientId: 'client', guildId: null },
    commands: [],
    rest
  });

  assert.equal(calls[0].route, Routes.applicationCommands('client'));
});

test('configureRestProxy installs the proxy dispatcher on the deployment client', () => {
  const installed = [];
  const restAgent = { name: 'rest-proxy' };
  const rest = {
    setAgent(agent) {
      installed.push(agent);
      return this;
    }
  };

  const result = configureRestProxy(
    rest,
    'http://127.0.0.1:7897',
    proxyUrl => {
      assert.equal(proxyUrl, 'http://127.0.0.1:7897');
      return { restAgent, websocketAgent: { name: 'ws-proxy' } };
    }
  );

  assert.equal(result, rest);
  assert.deepEqual(installed, [restAgent]);
});

test('shutdownBot closes the database and destroys the client', () => {
  const state = { databaseClosed: false, clientDestroyed: false };
  shutdownBot(
    { destroy() { state.clientDestroyed = true; } },
    { close() { state.databaseClosed = true; } }
  );

  assert.deepEqual(state, { databaseClosed: true, clientDestroyed: true });
});

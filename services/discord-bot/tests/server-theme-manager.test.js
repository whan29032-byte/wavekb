'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Routes } = require('discord.js');

const capturedSnapshot = require('./fixtures/server-theme-snapshot.json');
const {
  CHANNEL_CHANGES,
  GROWTH_ROLE_CHANGES,
  MAGIC_GROWTH_ROLE_DEFINITIONS,
  IDENTITY_ROLE_DEFINITIONS,
  buildThemePlan
} = require('../server-theme');
const {
  fetchThemeSnapshot,
  saveThemeSnapshotBundle,
  dryRunTheme,
  createAssetFetcher,
  assertApplyConfirmation,
  runThemeApplyPhase,
  ensureIdentityRoles,
  ensureMagicGrowthRoles,
  applyChannelPatches,
  applyGrowthRolePatches,
  upsertWelcomeMessage,
  rollbackTheme,
  verifyThemeTransition,
  assertRollbackSnapshot,
  ThemePhaseError
} = require('../server-theme-manager');

const GUILD_ID = '1545731927733047306';

function clone(value) {
  return structuredClone(value);
}

function apiResponses(snapshot = capturedSnapshot) {
  return {
    [Routes.guild(GUILD_ID)]: {
      id: snapshot.guild.id,
      name: snapshot.guild.name,
      premium_tier: snapshot.guild.premiumTier,
      premium_subscription_count: snapshot.guild.premiumSubscriptionCount,
      icon: snapshot.guild.icon ?? null,
      banner: snapshot.guild.banner ?? null,
      splash: snapshot.guild.splash ?? null,
      owner_id: snapshot.guild.ownerId ?? 'owner-user',
      features: snapshot.guild.features ?? ['BANNER', 'INVITE_SPLASH', 'ROLE_ICONS'],
      authorization: 'must-not-survive'
    },
    [Routes.guildChannels(GUILD_ID)]: snapshot.channels.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parent_id: channel.parentId,
      position: channel.position,
      topic: channel.topic,
      permission_overwrites: (channel.permissionOverwrites || []).map(overwrite => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny
      })),
      token: 'must-not-survive'
    })),
    [Routes.guildRoles(GUILD_ID)]: snapshot.roles.map(role => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      permissions: role.permissions,
      managed: role.managed,
      icon: role.icon,
      unicode_emoji: role.unicodeEmoji,
      authorization: 'must-not-survive'
    })),
    [Routes.user('@me')]: { id: 'bot-user', bot: true },
    [Routes.guildMember(GUILD_ID, 'bot-user')]: {
      user: { id: 'bot-user' },
      roles: ['1545774191494570017']
    }
  };
}

class FakeRest {
  constructor(responses = apiResponses()) {
    this.responses = responses;
    this.calls = [];
    this.nextRole = 1;
    this.failPatchAt = null;
    this.failPostAt = null;
    this.unknownMessageRoutes = new Set();
  }

  async get(route, options) {
    this.calls.push({ method: 'get', route });
    if (!(route in this.responses)) throw new Error(`missing response: ${route}`);
    const response = this.responses[route];
    return clone(typeof response === 'function' ? await response(options) : response);
  }

  async post(route, options) {
    this.calls.push({ method: 'post', route, options: clone(options) });
    const postCount = this.calls.filter(call => call.method === 'post').length;
    if (this.failPostAt === postCount) throw new Error('Missing Permissions');
    return { id: `created-role-${this.nextRole++}` };
  }

  async patch(route, options) {
    this.calls.push({ method: 'patch', route, options: clone(options) });
    if (this.unknownMessageRoutes.has(route)) {
      const error = new Error('Unknown Message');
      error.code = 10008;
      throw error;
    }
    const patchCount = this.calls.filter(call => call.method === 'patch').length;
    if (this.failPatchAt === patchCount) throw new Error('Missing Permissions');
    return { id: route.split('/').at(-1) };
  }
}

function makeAppliedSnapshot() {
  const snapshot = clone(capturedSnapshot);
  snapshot.guild.icon = 'theme-server-icon';
  snapshot.guild.banner = 'theme-server-banner';
  snapshot.guild.splash = 'theme-invite-splash';
  for (const change of CHANNEL_CHANGES) {
    const channel = snapshot.channels.find(({ id }) => id === change.id);
    channel.name = change.name;
    if (Object.hasOwn(change, 'topic')) channel.topic = change.topic;
  }
  for (const change of GROWTH_ROLE_CHANGES) {
    const role = snapshot.roles.find(({ id }) => id === change.id);
    role.name = change.name;
    role.color = change.color;
    role.icon = `theme-${change.iconKey}`;
  }
  snapshot.roles.find(({ id }) => id === '1545774191494570017').position = 13;
  for (const [index, definition] of IDENTITY_ROLE_DEFINITIONS.entries()) {
    snapshot.roles.push({
      id: `theme-identity-${index}`,
      name: definition.name,
      color: definition.color,
      position: 20 + index,
      permissions: definition.permissions,
      managed: false,
      icon: `theme-${definition.iconKey}`,
      unicodeEmoji: null
    });
  }
  for (const [index, definition] of MAGIC_GROWTH_ROLE_DEFINITIONS.entries()) {
    snapshot.roles.push({
      id: `theme-magic-growth-${index}`,
      name: definition.name,
      color: definition.color,
      position: 1 + index,
      permissions: definition.permissions,
      managed: false,
      icon: `theme-${definition.iconKey}`,
      unicodeEmoji: null
    });
  }
  return snapshot;
}

function roleIconHashes(snapshot) {
  return Object.fromEntries(
    snapshot.roles.filter(role => role.icon).map(role => [role.id, role.icon])
  );
}

function magicGrowthRoleIds(snapshot) {
  return MAGIC_GROWTH_ROLE_DEFINITIONS.map(({ name }) => (
    snapshot.roles.find(role => role.name === name).id
  ));
}

test('snapshot is sanitized and contains no authorization data', async () => {
  const rest = new FakeRest();

  const snapshot = await fetchThemeSnapshot(rest, GUILD_ID);

  assert.deepEqual(snapshot.guild, {
    id: GUILD_ID,
    name: '悠の学园都市',
    premiumTier: 2,
    premiumSubscriptionCount: 14,
    icon: null,
    banner: null,
    splash: null,
    ownerId: 'owner-user',
    features: ['BANNER', 'INVITE_SPLASH', 'ROLE_ICONS']
  });
  assert.equal(snapshot.channels.length, 16);
  assert.equal(snapshot.roles.length, 11);
  assert.deepEqual(snapshot.channels[0].permissionOverwrites, []);
  assert.equal(JSON.stringify(snapshot).includes('authorization'), false);
  assert.equal(JSON.stringify(snapshot).includes('must-not-survive'), false);
});

test('snapshot bundle preserves existing guild media for rollback', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-theme-backup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const snapshot = clone(capturedSnapshot);
  Object.assign(snapshot.guild, {
    icon: 'icon-hash',
    banner: 'a_banner-hash',
    splash: 'splash-hash'
  });
  const urls = [];

  const bundle = await saveThemeSnapshotBundle(
    snapshot,
    directory,
    () => new Date('2026-11-24T08:09:10.000Z'),
    async url => {
      urls.push(url);
      return Buffer.from(`asset:${url}`);
    }
  );

  assert.equal(fs.existsSync(bundle.manifestPath), true);
  assert.deepEqual(Object.keys(bundle.assetPaths).sort(), ['banner', 'icon', 'splash']);
  assert.equal(Object.values(bundle.assetPaths).every(assetPath => fs.existsSync(assetPath)), true);
  assert.equal(urls.length, 3);
  assert.match(urls.find(url => url.includes('/banners/')), /\.gif\?size=4096$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(bundle.manifestPath, 'utf8')), snapshot);
});

test('snapshot bundle preserves existing target role icons for rollback', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-role-icon-backup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const snapshot = clone(capturedSnapshot);
  const target = snapshot.roles.find(({ id }) => id === GROWTH_ROLE_CHANGES[0].id);
  target.icon = 'existing-role-icon-hash';
  const urls = [];

  const bundle = await saveThemeSnapshotBundle(
    snapshot,
    directory,
    () => new Date('2026-11-24T08:09:10.000Z'),
    async url => {
      urls.push(url);
      return Buffer.from('role-icon');
    }
  );

  assert.equal(fs.existsSync(bundle.assetPaths.roleIcons[target.id]), true);
  assert.match(urls[0], new RegExp(`/role-icons/${target.id}/existing-role-icon-hash\\.png`));
});

test('asset backups use the configured proxy dispatcher, finite retry, and image validation', async () => {
  const dispatcher = { name: 'proxy-dispatcher' };
  const calls = [];
  const fetcher = createAssetFetcher(dispatcher, {
    retries: 1,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      if (calls.length === 1) throw new Error('temporary network failure');
      return {
        ok: true,
        status: 200,
        headers: { get: name => name.toLowerCase() === 'content-type' ? 'image/png' : null },
        async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; }
      };
    }
  });

  assert.deepEqual(await fetcher('https://cdn.discordapp.com/test.png'), Buffer.from([1, 2, 3]));
  assert.equal(calls.length, 2);
  assert.equal(calls.every(call => call.options.dispatcher === dispatcher), true);

  const invalid = createAssetFetcher(null, {
    retries: 0,
    async fetchImpl() {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        async arrayBuffer() { return Uint8Array.from([1]).buffer; }
      };
    }
  });
  await assert.rejects(invalid('https://cdn.discordapp.com/not-image'), /图片/);
});

test('dry-run performs no post or patch calls', async () => {
  const rest = new FakeRest();

  const result = await dryRunTheme(rest, GUILD_ID);

  assert.equal(result.validation.ok, true);
  assert.equal(result.plan.channelPatches.length, 15);
  assert.equal(result.plan.magicGrowthRoles.length, 6);
  assert.equal(result.preflight.ok, false);
  assert.deepEqual(
    result.preflight.blockers.filter(({ reason }) => reason === 'role_above_bot').map(({ id }) => id),
    GROWTH_ROLE_CHANGES.map(({ id }) => id)
  );
  assert.equal(result.preflight.blockers.some(({ reason }) => reason === 'missing_manage_guild'), true);
  assert.equal(rest.calls.some(({ method }) => ['post', 'patch'].includes(method)), false);
});

test('apply requires the exact confirm-guild value', () => {
  assert.doesNotThrow(() => assertApplyConfirmation(GUILD_ID, GUILD_ID));
  for (const value of [undefined, '', 'wrong-guild', ` ${GUILD_ID} `]) {
    assert.throws(() => assertApplyConfirmation(value, GUILD_ID), /--confirm-guild/);
  }
});

test('snapshot drift aborts before the first write', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-theme-drift-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const drifted = clone(capturedSnapshot);
  drifted.channels.find(({ id }) => id === CHANNEL_CHANGES[0].id).name = 'unexpected';
  const rest = new FakeRest(apiResponses(drifted));

  await assert.rejects(
    runThemeApplyPhase({
      rest,
      guildId: GUILD_ID,
      confirmGuild: GUILD_ID,
      phase: 'channels',
      backupDirectory: directory
    }),
    /主题快照校验失败/
  );
  assert.equal(rest.calls.some(({ method }) => ['post', 'patch'].includes(method)), false);
  assert.equal(fs.readdirSync(directory).length, 0);
});

test('apply preflight blocks growth roles above the bot before backup or writes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-theme-preflight-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const rest = new FakeRest();

  await assert.rejects(
    runThemeApplyPhase({
      rest,
      guildId: GUILD_ID,
      confirmGuild: GUILD_ID,
      phase: 'growth-roles',
      backupDirectory: directory,
      iconLoader: async () => Buffer.from('icon')
    }),
    error => {
      assert.equal(error instanceof ThemePhaseError, true);
      assert.equal(error.phase, 'preflight');
      assert.deepEqual(error.blockedIds, GROWTH_ROLE_CHANGES.map(({ id }) => id));
      return true;
    }
  );
  assert.equal(rest.calls.some(({ method }) => ['post', 'patch'].includes(method)), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('identity-role creation is idempotent and uses zero permissions', async () => {
  const rest = new FakeRest();

  const first = await ensureIdentityRoles(rest, capturedSnapshot, IDENTITY_ROLE_DEFINITIONS);

  assert.deepEqual(first.createdIds, ['created-role-1', 'created-role-2', 'created-role-3']);
  assert.deepEqual(first, {
    esperRoleId: 'created-role-1',
    magicianRoleId: 'created-role-2',
    saintRoleId: 'created-role-3',
    createdIds: ['created-role-1', 'created-role-2', 'created-role-3'],
    updatedIds: []
  });
  const posts = rest.calls.filter(({ method }) => method === 'post');
  assert.equal(posts.length, 3);
  assert.equal(posts.every(call => call.options.body.permissions === '0'), true);

  const existing = clone(capturedSnapshot);
  IDENTITY_ROLE_DEFINITIONS.forEach((definition, index) => {
    existing.roles.push({
      id: `existing-${index}`,
      name: definition.name,
      color: definition.color,
      position: 1,
      permissions: '0',
      managed: false,
      icon: null,
      unicodeEmoji: null
    });
  });
  const idempotentRest = new FakeRest();
  const second = await ensureIdentityRoles(idempotentRest, existing, IDENTITY_ROLE_DEFINITIONS);
  assert.deepEqual(second.createdIds, []);
  assert.equal(idempotentRest.calls.length, 0);

  const repairRest = new FakeRest();
  const repaired = await ensureIdentityRoles(
    repairRest,
    existing,
    IDENTITY_ROLE_DEFINITIONS,
    async key => Buffer.from(key)
  );
  assert.deepEqual(repaired.createdIds, []);
  assert.deepEqual(repaired.updatedIds, ['existing-0', 'existing-1', 'existing-2']);
  assert.equal(repairRest.calls.every(({ method }) => method === 'patch'), true);
  assert.equal(repairRest.calls.every(call => /^data:image\/png;base64,/.test(call.options.body.icon)), true);
});

test('identity-role repair reports roles created earlier in the same failed phase', async () => {
  const snapshot = clone(capturedSnapshot);
  const magician = IDENTITY_ROLE_DEFINITIONS[1];
  snapshot.roles.push({
    id: 'existing-magician',
    name: magician.name,
    color: magician.color,
    position: 1,
    permissions: '0',
    managed: false,
    icon: 'old-icon',
    unicodeEmoji: null
  });
  const rest = new FakeRest();
  rest.failPatchAt = 1;

  await assert.rejects(
    ensureIdentityRoles(
      rest,
      snapshot,
      IDENTITY_ROLE_DEFINITIONS,
      async key => Buffer.from(key),
      { 'existing-magician': 'expected-icon' }
    ),
    error => {
      assert.deepEqual(error.completedResults, [{ id: 'created-role-1', status: 'created' }]);
      return true;
    }
  );
});

test('dry-run checks a renamed persisted magic role hierarchy by stable id', async () => {
  const snapshot = makeAppliedSnapshot();
  const magicRoleIds = magicGrowthRoleIds(snapshot);
  const target = snapshot.roles.find(({ id }) => id === magicRoleIds[0]);
  target.name = 'renamed-magic-stage';
  target.position = 14;
  const rest = new FakeRest(apiResponses(snapshot));

  const result = await dryRunTheme(
    rest,
    GUILD_ID,
    roleIconHashes(snapshot),
    magicRoleIds
  );

  assert.equal(result.plan.magicGrowthRolePatches[0].id, target.id);
  assert.equal(
    result.preflight.blockers.some(blocker => (
      blocker.phase === 'magic-growth-roles' &&
      blocker.id === target.id &&
      blocker.reason === 'role_above_bot'
    )),
    true
  );
});

test('dry-run checks science role hierarchy even when no appearance patch is needed', async () => {
  const snapshot = makeAppliedSnapshot();
  const target = snapshot.roles.find(({ id }) => id === GROWTH_ROLE_CHANGES[0].id);
  target.position = 14;
  const rest = new FakeRest(apiResponses(snapshot));

  const result = await dryRunTheme(rest, GUILD_ID, roleIconHashes(snapshot));

  assert.equal(result.plan.growthRolePatches.length, 0);
  assert.equal(
    result.preflight.blockers.some(blocker => (
      blocker.phase === 'growth-roles' &&
      blocker.id === target.id &&
      blocker.reason === 'role_above_bot'
    )),
    true
  );
});

test('dry-run checks persisted magic role hierarchy even when no appearance patch is needed', async () => {
  const snapshot = makeAppliedSnapshot();
  const magicRoleIds = magicGrowthRoleIds(snapshot);
  const target = snapshot.roles.find(({ id }) => id === magicRoleIds[0]);
  target.position = 14;
  const rest = new FakeRest(apiResponses(snapshot));

  const result = await dryRunTheme(
    rest,
    GUILD_ID,
    roleIconHashes(snapshot),
    magicRoleIds
  );

  assert.equal(result.plan.magicGrowthRolePatches.length, 0);
  assert.equal(
    result.preflight.blockers.some(blocker => (
      blocker.phase === 'magic-growth-roles' &&
      blocker.id === target.id &&
      blocker.reason === 'role_above_bot'
    )),
    true
  );
});

test('magic growth role creation is idempotent, zero-permission, and repairs stale icons', async () => {
  const rest = new FakeRest();

  const first = await ensureMagicGrowthRoles(
    rest,
    capturedSnapshot,
    MAGIC_GROWTH_ROLE_DEFINITIONS,
    async key => Buffer.from(key)
  );

  assert.deepEqual(first.magicRoleIds, [
    'created-role-1', 'created-role-2', 'created-role-3',
    'created-role-4', 'created-role-5', 'created-role-6'
  ]);
  assert.equal(rest.calls.filter(({ method }) => method === 'post').length, 6);
  assert.equal(rest.calls.every(call => call.options.body.permissions === '0'), true);

  const existing = makeAppliedSnapshot();
  const expectedIcons = roleIconHashes(existing);
  const target = existing.roles.find(({ name }) => name === MAGIC_GROWTH_ROLE_DEFINITIONS[0].name);
  target.icon = 'stale-icon';
  const repairRest = new FakeRest();
  const second = await ensureMagicGrowthRoles(
    repairRest,
    existing,
    MAGIC_GROWTH_ROLE_DEFINITIONS,
    async key => Buffer.from(key),
    expectedIcons
  );

  assert.deepEqual(second.createdIds, []);
  assert.deepEqual(second.updatedIds, [target.id]);
  assert.equal(repairRest.calls.length, 1);
  assert.equal(repairRest.calls[0].method, 'patch');
});

test('magic growth role repair resolves persisted stages by id after a rename', async () => {
  const existing = makeAppliedSnapshot();
  const magicRoleIds = magicGrowthRoleIds(existing);
  const target = existing.roles.find(({ id }) => id === magicRoleIds[0]);
  target.name = 'renamed-magic-stage';
  target.color = 0;
  const rest = new FakeRest();

  const result = await ensureMagicGrowthRoles(
    rest,
    existing,
    MAGIC_GROWTH_ROLE_DEFINITIONS,
    async key => Buffer.from(key),
    roleIconHashes(existing),
    magicRoleIds
  );

  assert.deepEqual(result.createdIds, []);
  assert.deepEqual(result.updatedIds, [target.id]);
  assert.equal(rest.calls.length, 1);
  assert.equal(rest.calls[0].route, Routes.guildRole(GUILD_ID, target.id));
  assert.equal(rest.calls[0].options.body.name, MAGIC_GROWTH_ROLE_DEFINITIONS[0].name);
  assert.equal(rest.calls[0].options.body.color, MAGIC_GROWTH_ROLE_DEFINITIONS[0].color);
});

test('magic growth role creation failure reports completed and remaining stages', async () => {
  const rest = new FakeRest();
  rest.failPostAt = 3;

  await assert.rejects(
    ensureMagicGrowthRoles(rest, capturedSnapshot, MAGIC_GROWTH_ROLE_DEFINITIONS),
    error => {
      assert.equal(error instanceof ThemePhaseError, true);
      assert.equal(error.phase, 'magic-growth-roles');
      assert.deepEqual(error.completedResults, [
        { id: 'created-role-1', status: 'created' },
        { id: 'created-role-2', status: 'created' }
      ]);
      assert.deepEqual(error.blockedIds, MAGIC_GROWTH_ROLE_DEFINITIONS.slice(2).map(({ key }) => key));
      return true;
    }
  );
});

test('magic growth role apply phase creates all six roles after backup', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-magic-growth-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const rest = new FakeRest();

  const applied = await runThemeApplyPhase({
    rest,
    guildId: GUILD_ID,
    confirmGuild: GUILD_ID,
    phase: 'magic-growth-roles',
    backupDirectory: directory,
    iconLoader: async key => Buffer.from(key)
  });

  assert.equal(fs.existsSync(applied.snapshotPath), true);
  assert.equal(applied.result.magicRoleIds.length, 6);
  assert.equal(rest.calls.filter(({ method }) => method === 'post').length, 6);
});

test('channel apply never sends parent_id position or permission_overwrites', async () => {
  const rest = new FakeRest();
  const plan = buildThemePlan(capturedSnapshot);

  const results = await applyChannelPatches(rest, plan);

  assert.equal(results.length, 15);
  for (const call of rest.calls) {
    assert.equal(call.method, 'patch');
    assert.deepEqual(
      Object.keys(call.options.body).filter(key => ['parent_id', 'position', 'permission_overwrites'].includes(key)),
      []
    );
    assert.equal(Object.keys(call.options.body).every(key => ['name', 'topic'].includes(key)), true);
  }
});

test('growth-role apply can repair a missing icon without rewriting permissions', async () => {
  const rest = new FakeRest();
  const plan = { growthRolePatches: [{ id: 'role-id', iconKey: 'stage-1' }] };

  const results = await applyGrowthRolePatches(
    rest,
    plan,
    async () => Buffer.from('icon-data'),
    GUILD_ID
  );

  assert.deepEqual(results, [{ id: 'role-id', status: 'applied' }]);
  assert.deepEqual(rest.calls[0].options.body, {
    icon: `data:image/png;base64,${Buffer.from('icon-data').toString('base64')}`,
    unicode_emoji: null
  });
  assert.equal('permissions' in rest.calls[0].options.body, false);
});

test('hierarchy or permission failures stop the current phase and report blocked IDs', async () => {
  const rest = new FakeRest();
  rest.failPatchAt = 2;
  const plan = {
    channelPatches: [
      { id: 'channel-1', name: 'one' },
      { id: 'channel-2', name: 'two' },
      { id: 'channel-3', name: 'three' }
    ]
  };

  await assert.rejects(
    applyChannelPatches(rest, plan),
    error => {
      assert.equal(error instanceof ThemePhaseError, true);
      assert.deepEqual(error.blockedIds, ['channel-2', 'channel-3']);
      assert.deepEqual(error.completedResults, [{ id: 'channel-1', status: 'applied' }]);
      assert.equal(error.message.includes('Missing Permissions'), false);
      return true;
    }
  );
  assert.equal(rest.calls.filter(({ method }) => method === 'patch').length, 2);
});

test('a partial apply error retains completed results and its recovery snapshot path', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-theme-partial-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const rest = new FakeRest();
  rest.failPatchAt = 2;

  await assert.rejects(
    runThemeApplyPhase({
      rest,
      guildId: GUILD_ID,
      confirmGuild: GUILD_ID,
      phase: 'channels',
      backupDirectory: directory
    }),
    error => {
      assert.equal(error instanceof ThemePhaseError, true);
      assert.deepEqual(error.completedResults, [{
        id: CHANNEL_CHANGES[0].id,
        status: 'applied'
      }]);
      assert.equal(fs.existsSync(error.snapshotPath), true);
      return true;
    }
  );
});

test('welcome apply updates the recorded message instead of creating a duplicate', async () => {
  const rest = new FakeRest();
  const payload = { content: 'welcome', embeds: [], allowed_mentions: { parse: [] } };

  const result = await upsertWelcomeMessage(rest, 'channel-id', payload, 'message-id');

  assert.deepEqual(result, { messageId: 'message-id', action: 'updated' });
  assert.deepEqual(rest.calls, [{
    method: 'patch',
    route: Routes.channelMessage('channel-id', 'message-id'),
    options: { body: payload }
  }]);
});

test('welcome apply recovers from stale state by finding the bot-authored marker', async () => {
  const rest = new FakeRest();
  rest.unknownMessageRoutes.add(Routes.channelMessage('channel-id', 'stale-message'));
  rest.responses[Routes.channelMessages('channel-id')] = [{
    id: 'recovered-message',
    author: { id: 'bot-user', bot: true },
    embeds: [{ footer: { text: '悠の学园都市 · INDEX_THEME_WELCOME_V1' } }]
  }];
  const payload = {
    content: 'welcome',
    embeds: [{ footer: { text: '悠の学园都市 · INDEX_THEME_WELCOME_V1' } }],
    allowed_mentions: { parse: [] }
  };

  const result = await upsertWelcomeMessage(rest, 'channel-id', payload, 'stale-message');

  assert.deepEqual(result, { messageId: 'recovered-message', action: 'updated' });
  assert.equal(rest.calls.some(({ method }) => method === 'post'), false);
  assert.equal(
    rest.calls.some(call => call.method === 'patch' && call.route === Routes.channelMessage('channel-id', 'recovered-message')),
    true
  );
});

test('welcome marker recovery paginates beyond the newest one hundred messages', async () => {
  const rest = new FakeRest();
  const route = Routes.channelMessages('channel-id');
  const newest = Array.from({ length: 100 }, (_, index) => ({
    id: `new-${index}`,
    author: { id: 'someone-else', bot: false },
    embeds: []
  }));
  rest.responses[route] = options => {
    const before = options?.query?.get('before');
    if (!before) return newest;
    assert.equal(before, 'new-99');
    return [{
      id: 'older-marker',
      author: { id: 'bot-user', bot: true },
      embeds: [{ footer: { text: 'INDEX_THEME_WELCOME_V1' } }]
    }];
  };
  const payload = {
    content: 'welcome',
    embeds: [{ footer: { text: 'INDEX_THEME_WELCOME_V1' } }],
    allowed_mentions: { parse: [] }
  };

  const result = await upsertWelcomeMessage(rest, 'channel-id', payload);

  assert.deepEqual(result, { messageId: 'older-marker', action: 'updated' });
  assert.equal(rest.calls.filter(call => call.method === 'get' && call.route === route).length, 2);
  assert.equal(rest.calls.some(({ method }) => method === 'post'), false);
});

test('transition verification permits approved changes and rejects structural or permission drift', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  const expectedIcons = roleIconHashes(after);

  assert.deepEqual(verifyThemeTransition(before, after, expectedIcons), { ok: true, errors: [] });

  const drifted = clone(after);
  drifted.channels[0].position += 1;
  drifted.channels[2].parentId = null;
  drifted.channels[2].permissionOverwrites = [{ id: 'role-x', type: 0, allow: '1', deny: '0' }];
  drifted.roles.find(({ id }) => id === GROWTH_ROLE_CHANGES[0].id).permissions = '8';
  drifted.channels.pop();

  const result = verifyThemeTransition(before, drifted, expectedIcons);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /频道数量|频道集合/);
  assert.match(result.errors.join('\n'), /父分类/);
  assert.match(result.errors.join('\n'), /权限覆盖/);
  assert.match(result.errors.join('\n'), /角色.*权限/);
});

test('transition verification accepts Discord position renumbering when sibling order is unchanged', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  const renumberedPositions = new Map([
    ['1545732134499647629', 7],
    ['1545734159593377932', 6],
    ['1545734517371969616', 8],
    ['1545852514942062652', 11],
    ['1558681467268239482', 3]
  ]);
  for (const channel of after.channels) {
    if (renumberedPositions.has(channel.id)) channel.position = renumberedPositions.get(channel.id);
  }

  const result = verifyThemeTransition(before, after, roleIconHashes(after));

  assert.deepEqual(result, { ok: true, errors: [] });
});

test('transition verification accepts the approved bot role elevation', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  after.roles.find(({ id }) => id === '1545774191494570017').position = 13;

  const result = verifyThemeTransition(before, after, roleIconHashes(after));

  assert.deepEqual(result, { ok: true, errors: [] });
});

test('transition verification still rejects unrelated sibling channel reordering', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  after.roles.find(({ id }) => id === '1545774191494570017').position = 13;
  const firstChannel = after.channels.find(({ id }) => id === '1546525345358811246');
  const secondChannel = after.channels.find(({ id }) => id === '1558677883193397258');
  [firstChannel.position, secondChannel.position] = [secondChannel.position, firstChannel.position];

  const result = verifyThemeTransition(before, after, roleIconHashes(after));

  assert.equal(result.ok, false);
  assert.equal(result.errors.includes('频道排序发生变化'), true);
});

test('transition verification still rejects unrelated existing role reordering', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  after.roles.find(({ id }) => id === '1545774191494570017').position = 13;
  const firstRole = after.roles.find(({ id }) => id === '1560688613967138857');
  const secondRole = after.roles.find(({ id }) => id === '1574793945060479089');
  [firstRole.position, secondRole.position] = [secondRole.position, firstRole.position];

  const result = verifyThemeTransition(before, after, roleIconHashes(after));

  assert.equal(result.ok, false);
  assert.equal(result.errors.includes('既有角色层级顺序发生变化'), true);
});

test('transition verification rejects a bot role elevation that leaves a growth role above it', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  after.roles.find(({ id }) => id === '1545774191494570017').position = 9;

  const result = verifyThemeTransition(before, after, roleIconHashes(after));

  assert.equal(result.ok, false);
});

test('transition verification rejects the bot role moving down', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  after.roles.find(({ id }) => id === '1545774191494570017').position = 0;

  const result = verifyThemeTransition(before, after, roleIconHashes(after));

  assert.equal(result.ok, false);
});

test('transition verification rejects the bot role crossing an unrelated existing role', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  before.roles.find(({ id }) => id === '1560688613967138857').position = 11;
  after.roles.find(({ id }) => id === '1560688613967138857').position = 11;
  after.roles.find(({ id }) => id === '1545774191494570017').position = 13;

  const result = verifyThemeTransition(before, after, roleIconHashes(after));

  assert.equal(result.ok, false);
});

test('transition verification rejects an incomplete theme terminal state', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  const growthRole = after.roles.find(({ id }) => id === GROWTH_ROLE_CHANGES[0].id);
  growthRole.icon = null;
  after.channels.find(({ id }) => id === CHANNEL_CHANGES[0].id).name = CHANNEL_CHANGES[0].expectedName;
  after.guild.banner = null;

  const expectedIcons = roleIconHashes(makeAppliedSnapshot());
  const result = verifyThemeTransition(before, after, expectedIcons);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some(error => error.includes('频道') && error.includes('未达到主题终态')), true);
  assert.equal(result.errors.some(error => error.includes('成长角色') && error.includes('图标')), true);
  assert.equal(result.errors.some(error => error.includes('服务器横幅')), true);
});

test('transition verification rejects a missing magic growth role', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  after.roles = after.roles.filter(({ name }) => name !== MAGIC_GROWTH_ROLE_DEFINITIONS[0].name);

  const result = verifyThemeTransition(before, after, roleIconHashes(after));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /魔法成长角色/);
});

test('transition verification rejects repurposing an unrelated existing role as a magic stage', () => {
  const before = makeAppliedSnapshot();
  before.roles.push({
    id: 'unrelated-zero-role',
    name: 'unrelated-zero-role',
    color: 0,
    position: 1,
    permissions: '0',
    managed: false,
    icon: null,
    unicodeEmoji: null
  });
  const after = clone(before);
  const magicRoleIds = magicGrowthRoleIds(before);
  const definition = MAGIC_GROWTH_ROLE_DEFINITIONS[0];
  after.roles.find(({ id }) => id === magicRoleIds[0]).name = 'renamed-original-magic-stage';
  const unrelated = after.roles.find(({ id }) => id === 'unrelated-zero-role');
  unrelated.name = definition.name;
  unrelated.color = definition.color;
  unrelated.permissions = definition.permissions;
  unrelated.icon = `theme-${definition.iconKey}`;

  const result = verifyThemeTransition(
    before,
    after,
    roleIconHashes(after),
    magicRoleIds
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors.some(error => error.includes(unrelated.id)), true);
});

test('transition verification rejects a nonmatching nonempty role icon', () => {
  const before = clone(capturedSnapshot);
  const after = makeAppliedSnapshot();
  const expectedIcons = roleIconHashes(after);
  const target = after.roles.find(({ id }) => id === GROWTH_ROLE_CHANGES[0].id);
  target.icon = 'wrong-but-nonempty-icon';

  const result = verifyThemeTransition(before, after, expectedIcons);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /图标.*不匹配|不匹配.*图标/);
});

test('rollback snapshot must belong to the target guild and pass manifest validation', () => {
  assert.doesNotThrow(() => assertRollbackSnapshot(capturedSnapshot, GUILD_ID));
  const wrongGuild = clone(capturedSnapshot);
  wrongGuild.guild.id = 'other-guild';
  assert.throws(() => assertRollbackSnapshot(wrongGuild, GUILD_ID), /目标服务器/);
  const drifted = clone(capturedSnapshot);
  drifted.channels[0].name = 'unexpected';
  assert.throws(() => assertRollbackSnapshot(drifted, GUILD_ID), /回滚快照校验失败/);
});

test('rollback restores only approved names topics colors and guild assets', async () => {
  const before = clone(capturedSnapshot);
  before.guildAssets = {
    icon: 'data:image/png;base64,aWNvbg==',
    banner: 'data:image/png;base64,YmFubmVy',
    splash: 'data:image/png;base64,c3BsYXNo'
  };
  const originalIconRole = before.roles.find(({ id }) => id === GROWTH_ROLE_CHANGES[0].id);
  originalIconRole.icon = 'original-icon-hash';
  before.roleIconAssets = {
    [originalIconRole.id]: 'data:image/png;base64,b3JpZ2luYWw='
  };
  const current = makeAppliedSnapshot();
  const rest = new FakeRest();

  const results = await rollbackTheme(rest, before, current);

  assert.equal(results.length, CHANNEL_CHANGES.length + GROWTH_ROLE_CHANGES.length + 1);
  const allowedChannelIds = new Set(CHANNEL_CHANGES.map(({ id }) => id));
  const allowedRoleIds = new Set(GROWTH_ROLE_CHANGES.map(({ id }) => id));
  for (const call of rest.calls) {
    assert.equal(call.method, 'patch');
    if (call.route === Routes.guild(GUILD_ID)) {
      assert.deepEqual(Object.keys(call.options.body).sort(), ['banner', 'icon', 'splash']);
      continue;
    }
    const targetId = call.route.split('/').at(-1);
    if (allowedChannelIds.has(targetId)) {
      assert.equal(Object.keys(call.options.body).every(key => ['name', 'topic'].includes(key)), true);
    } else {
      assert.equal(allowedRoleIds.has(targetId), true);
      assert.equal(
        Object.keys(call.options.body).every(key => ['name', 'color', 'icon', 'unicode_emoji'].includes(key)),
        true
      );
    }
    assert.equal('permissions' in call.options.body, false);
    assert.equal('parent_id' in call.options.body, false);
    assert.equal('position' in call.options.body, false);
  }
  const originalIconPatch = rest.calls.find(call => call.route.endsWith(`/${originalIconRole.id}`));
  assert.equal(originalIconPatch.options.body.icon, before.roleIconAssets[originalIconRole.id]);
});

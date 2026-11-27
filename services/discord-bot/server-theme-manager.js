'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Routes, PermissionFlagsBits } = require('discord.js');
const {
  TARGET_GUILD_ID,
  CHANNEL_CHANGES,
  GROWTH_ROLE_CHANGES,
  MAGIC_GROWTH_ROLE_DEFINITIONS,
  IDENTITY_ROLE_DEFINITIONS,
  validateThemeSnapshot,
  buildThemePlan
} = require('./server-theme');

const THEME_BOT_ROLE_ID = '1545774191494570017';

class ThemePhaseError extends Error {
  constructor(phase, blockedIds, { completedResults = [], snapshotPath = null } = {}) {
    super(`主题阶段写入受阻：${phase}`);
    this.name = 'ThemePhaseError';
    this.phase = phase;
    this.blockedIds = blockedIds;
    this.completedResults = completedResults;
    this.snapshotPath = snapshotPath;
  }
}

function asPermissionString(value) {
  return typeof value === 'string' ? value : String(value ?? '0');
}

async function fetchThemeSnapshot(rest, guildId) {
  const [guild, channels, roles] = await Promise.all([
    rest.get(Routes.guild(guildId)),
    rest.get(Routes.guildChannels(guildId)),
    rest.get(Routes.guildRoles(guildId))
  ]);

  return {
    guild: {
      id: guild.id,
      name: guild.name,
      premiumTier: guild.premium_tier ?? guild.premiumTier ?? 0,
      premiumSubscriptionCount: guild.premium_subscription_count ?? guild.premiumSubscriptionCount ?? 0,
      icon: guild.icon ?? null,
      banner: guild.banner ?? null,
      splash: guild.splash ?? null,
      ownerId: guild.owner_id ?? guild.ownerId ?? null,
      features: [...(guild.features || [])].sort()
    },
    channels: channels.map(channel => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parent_id ?? channel.parentId ?? null,
      position: channel.position,
      topic: channel.topic ?? null,
      permissionOverwrites: (channel.permission_overwrites ?? channel.permissionOverwrites ?? [])
        .map(overwrite => ({
          id: overwrite.id,
          type: Number(overwrite.type),
          allow: asPermissionString(overwrite.allow),
          deny: asPermissionString(overwrite.deny)
        }))
        .sort((first, second) => `${first.type}:${first.id}`.localeCompare(`${second.type}:${second.id}`))
    })),
    roles: roles.map(role => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      permissions: asPermissionString(role.permissions),
      managed: Boolean(role.managed),
      icon: role.icon ?? null,
      unicodeEmoji: role.unicode_emoji ?? role.unicodeEmoji ?? null
    }))
  };
}

function timestampForPath(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('备份时间无效');
  return date.toISOString().replace(/[:.]/g, '-');
}

function guildMediaUrl(guildId, kind, hash) {
  const extension = hash.startsWith('a_') ? 'gif' : 'png';
  const folders = { icon: 'icons', banner: 'banners', splash: 'splashes' };
  return `https://cdn.discordapp.com/${folders[kind]}/${guildId}/${hash}.${extension}?size=4096`;
}

function roleIconUrl(roleId, hash) {
  return `https://cdn.discordapp.com/role-icons/${roleId}/${hash}.png?size=256`;
}

function createAssetFetcher(dispatcher = null, { fetchImpl = fetch, retries = 2 } = {}) {
  return async url => {
    let lastFailure;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const options = dispatcher ? { dispatcher } : {};
        const response = await fetchImpl(url, options);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType = response.headers?.get?.('content-type') || '';
        if (!contentType.toLowerCase().startsWith('image/')) {
          throw new Error('响应不是图片');
        }
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length === 0) throw new Error('图片响应为空');
        return data;
      } catch (error) {
        lastFailure = error;
      }
    }
    throw new Error(`素材备份失败：${lastFailure?.message || '未知错误'}`);
  };
}

const defaultAssetFetcher = createAssetFetcher();

async function saveThemeSnapshotBundle(
  snapshot,
  directory,
  clock = () => new Date(),
  assetFetcher = defaultAssetFetcher
) {
  const bundleDirectory = path.join(directory, `${timestampForPath(clock)}-before`);
  await fs.mkdir(bundleDirectory, { recursive: true });

  const manifestPath = path.join(bundleDirectory, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  const assetPaths = {};
  for (const kind of ['icon', 'banner', 'splash']) {
    const hash = snapshot.guild[kind];
    if (!hash) continue;
    const extension = hash.startsWith('a_') ? 'gif' : 'png';
    const assetPath = path.join(bundleDirectory, `${kind}.${extension}`);
    const data = await assetFetcher(guildMediaUrl(snapshot.guild.id, kind, hash));
    await fs.writeFile(assetPath, data);
    assetPaths[kind] = assetPath;
  }

  const roleIconPaths = {};
  const targetRoleIds = new Set(GROWTH_ROLE_CHANGES.map(({ id }) => id));
  for (const role of snapshot.roles) {
    if (!targetRoleIds.has(role.id) || !role.icon) continue;
    const assetPath = path.join(bundleDirectory, `role-${role.id}-icon.png`);
    const data = await assetFetcher(roleIconUrl(role.id, role.icon));
    await fs.writeFile(assetPath, data);
    roleIconPaths[role.id] = assetPath;
  }
  if (Object.keys(roleIconPaths).length > 0) assetPaths.roleIcons = roleIconPaths;

  return { manifestPath, assetPaths };
}

function rolePermissions(snapshot, roleIds) {
  const ids = new Set([snapshot.guild.id, ...roleIds]);
  return snapshot.roles
    .filter(({ id }) => ids.has(id))
    .reduce((permissions, role) => permissions | BigInt(role.permissions), 0n);
}

function applyOverwrite(permissions, overwrite) {
  if (!overwrite) return permissions;
  return (permissions & ~BigInt(overwrite.deny)) | BigInt(overwrite.allow);
}

function channelPermissions(snapshot, actor, channel) {
  if (actor.userId === snapshot.guild.ownerId) return ~0n;
  let permissions = rolePermissions(snapshot, actor.roleIds);
  if ((permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return permissions;
  const overwrites = channel.permissionOverwrites || [];
  permissions = applyOverwrite(
    permissions,
    overwrites.find(overwrite => overwrite.type === 0 && overwrite.id === snapshot.guild.id)
  );
  let roleDeny = 0n;
  let roleAllow = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type !== 0 || !actor.roleIds.includes(overwrite.id)) continue;
    roleDeny |= BigInt(overwrite.deny);
    roleAllow |= BigInt(overwrite.allow);
  }
  permissions = (permissions & ~roleDeny) | roleAllow;
  return applyOverwrite(
    permissions,
    overwrites.find(overwrite => overwrite.type === 1 && overwrite.id === actor.userId)
  );
}

function hasPermission(permissions, flag) {
  return (permissions & flag) === flag;
}

function evaluateThemePreflight(snapshot, actor, plan) {
  const basePermissions = actor.userId === snapshot.guild.ownerId
    ? ~0n
    : rolePermissions(snapshot, actor.roleIds);
  const administrator = hasPermission(basePermissions, PermissionFlagsBits.Administrator);
  const owner = actor.userId === snapshot.guild.ownerId;
  const rolesById = new Map(snapshot.roles.map(role => [role.id, role]));
  const highestRolePosition = owner
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, ...actor.roleIds.map(roleId => rolesById.get(roleId)?.position ?? 0));
  const blockers = [];

  if (administrator) blockers.push({ phase: 'all', id: actor.userId, reason: 'administrator_not_allowed' });
  if (!hasPermission(basePermissions, PermissionFlagsBits.ManageRoles)) {
    blockers.push({ phase: 'identity-roles', id: snapshot.guild.id, reason: 'missing_manage_roles' });
    blockers.push({ phase: 'magic-growth-roles', id: snapshot.guild.id, reason: 'missing_manage_roles' });
    blockers.push({ phase: 'growth-roles', id: snapshot.guild.id, reason: 'missing_manage_roles' });
  }
  if (!hasPermission(basePermissions, PermissionFlagsBits.ManageChannels)) {
    blockers.push({ phase: 'channels', id: snapshot.guild.id, reason: 'missing_manage_channels' });
  }
  if (!hasPermission(basePermissions, PermissionFlagsBits.ManageGuild)) {
    blockers.push({ phase: 'guild-assets', id: snapshot.guild.id, reason: 'missing_manage_guild' });
  }

  for (const change of GROWTH_ROLE_CHANGES) {
    const role = rolesById.get(change.id);
    if (!owner && role && role.position >= highestRolePosition) {
      blockers.push({ phase: 'growth-roles', id: role.id, reason: 'role_above_bot' });
    }
  }
  for (const definition of IDENTITY_ROLE_DEFINITIONS) {
    const role = snapshot.roles.find(({ name }) => name === definition.name);
    if (!owner && role && role.position >= highestRolePosition) {
      blockers.push({ phase: 'identity-roles', id: role.id, reason: 'role_above_bot' });
    }
  }
  for (const roleId of plan.magicGrowthRoleTargetIds) {
    const role = rolesById.get(roleId);
    if (!owner && role && role.position >= highestRolePosition) {
      blockers.push({ phase: 'magic-growth-roles', id: role.id, reason: 'role_above_bot' });
    }
  }

  const features = new Set(snapshot.guild.features || []);
  if (!features.has('ROLE_ICONS')) {
    blockers.push({ phase: 'identity-roles', id: snapshot.guild.id, reason: 'missing_role_icons_feature' });
    blockers.push({ phase: 'magic-growth-roles', id: snapshot.guild.id, reason: 'missing_role_icons_feature' });
    blockers.push({ phase: 'growth-roles', id: snapshot.guild.id, reason: 'missing_role_icons_feature' });
  }
  if (!features.has('BANNER')) blockers.push({ phase: 'guild-assets', id: snapshot.guild.id, reason: 'missing_banner_feature' });
  if (!features.has('INVITE_SPLASH')) blockers.push({ phase: 'guild-assets', id: snapshot.guild.id, reason: 'missing_invite_splash_feature' });

  const channelsById = new Map(snapshot.channels.map(channel => [channel.id, channel]));
  for (const patch of plan.channelPatches) {
    const channel = channelsById.get(patch.id);
    if (channel && !hasPermission(channelPermissions(snapshot, actor, channel), PermissionFlagsBits.ManageChannels)) {
      blockers.push({ phase: 'channels', id: patch.id, reason: 'channel_denies_manage_channels' });
    }
  }
  const welcomeChannel = channelsById.get('1545734710888632411');
  if (welcomeChannel) {
    const permissions = channelPermissions(snapshot, actor, welcomeChannel);
    for (const [flag, reason] of [
      [PermissionFlagsBits.ViewChannel, 'missing_view_channel'],
      [PermissionFlagsBits.SendMessages, 'missing_send_messages'],
      [PermissionFlagsBits.EmbedLinks, 'missing_embed_links'],
      [PermissionFlagsBits.ReadMessageHistory, 'missing_read_message_history']
    ]) {
      if (!hasPermission(permissions, flag)) blockers.push({ phase: 'welcome', id: welcomeChannel.id, reason });
    }
  }

  return {
    ok: blockers.length === 0,
    actorId: actor.userId,
    highestRolePosition,
    permissions: {
      administrator,
      manageGuild: hasPermission(basePermissions, PermissionFlagsBits.ManageGuild),
      manageChannels: hasPermission(basePermissions, PermissionFlagsBits.ManageChannels),
      manageRoles: hasPermission(basePermissions, PermissionFlagsBits.ManageRoles)
    },
    blockers
  };
}

async function fetchThemePreflight(rest, snapshot, plan) {
  const currentUser = await rest.get(Routes.user('@me'));
  const member = await rest.get(Routes.guildMember(snapshot.guild.id, currentUser.id));
  return evaluateThemePreflight(snapshot, {
    userId: currentUser.id,
    roleIds: member.roles || []
  }, plan);
}

function assertPhaseReady(preflight, phase) {
  const blockers = preflight.blockers.filter(blocker => blocker.phase === 'all' || blocker.phase === phase);
  if (blockers.length > 0) {
    throw new ThemePhaseError('preflight', [...new Set(blockers.map(({ id }) => id))]);
  }
}

async function dryRunTheme(
  rest,
  guildId = TARGET_GUILD_ID,
  expectedRoleIcons = {},
  magicGrowthRoleIds = []
) {
  const snapshot = await fetchThemeSnapshot(rest, guildId);
  const validation = validateThemeSnapshot(snapshot, magicGrowthRoleIds);
  const plan = buildThemePlan(snapshot, expectedRoleIcons, magicGrowthRoleIds);
  const preflight = await fetchThemePreflight(rest, snapshot, plan);
  return { snapshot, validation, plan, preflight };
}

function assertApplyConfirmation(confirmGuild, guildId = TARGET_GUILD_ID) {
  if (confirmGuild !== guildId) {
    throw new Error(`写入操作需要 --confirm-guild ${guildId}`);
  }
}

function toDataUri(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return `data:image/png;base64,${value.toString('base64')}`;
  throw new TypeError('素材必须是 data URI 或 Buffer');
}

async function ensureIdentityRoles(
  rest,
  snapshot,
  definitions,
  iconLoader = null,
  expectedRoleIcons = {}
) {
  const roleIds = {};
  const createdIds = [];
  const updatedIds = [];

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const existing = snapshot.roles.find(({ name }) => name === definition.name);
    if (existing) {
      roleIds[definition.key] = existing.id;
      if (iconLoader && existing.icon !== expectedRoleIcons[existing.id]) {
        try {
          await rest.patch(Routes.guildRole(snapshot.guild.id, existing.id), {
            body: {
              icon: toDataUri(await iconLoader(definition.iconKey)),
              unicode_emoji: null
            },
            reason: '悠の学园都市主题：修复路线身份图标'
          });
          updatedIds.push(existing.id);
        } catch {
          throw new ThemePhaseError(
            'identity-roles',
            definitions.slice(index).map(({ key }) => key),
            {
              completedResults: [
                ...createdIds.map(id => ({ id, status: 'created' })),
                ...updatedIds.map(id => ({ id, status: 'applied' }))
              ]
            }
          );
        }
      }
      continue;
    }

    const body = {
      name: definition.name,
      color: definition.color,
      permissions: '0'
    };

    try {
      if (iconLoader && definition.iconKey) {
        body.icon = toDataUri(await iconLoader(definition.iconKey));
      }
      const created = await rest.post(Routes.guildRoles(snapshot.guild.id), {
        body,
        reason: '悠の学园都市主题：创建路线身份角色'
      });
      roleIds[definition.key] = created.id;
      createdIds.push(created.id);
    } catch {
      throw new ThemePhaseError(
        'identity-roles',
        definitions.slice(index).map(({ key }) => key),
        {
          completedResults: [
            ...createdIds.map(id => ({ id, status: 'created' })),
            ...updatedIds.map(id => ({ id, status: 'applied' }))
          ]
        }
      );
    }
  }

  return {
    esperRoleId: roleIds.esper,
    magicianRoleId: roleIds.magician,
    saintRoleId: roleIds.saint,
    createdIds,
    updatedIds
  };
}

async function ensureMagicGrowthRoles(
  rest,
  snapshot,
  definitions,
  iconLoader = null,
  expectedRoleIcons = {},
  magicGrowthRoleIds = []
) {
  const magicRoleIds = [];
  const createdIds = [];
  const updatedIds = [];

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const stableRoleId = magicGrowthRoleIds[index] || null;
    const existing = stableRoleId
      ? snapshot.roles.find(({ id }) => id === stableRoleId)
      : snapshot.roles.find(({ name }) => name === definition.name);
    if (stableRoleId && !existing) {
      throw new ThemePhaseError(
        'magic-growth-roles',
        definitions.slice(index).map(({ key }) => key),
        {
          completedResults: [
            ...createdIds.map(id => ({ id, status: 'created' })),
            ...updatedIds.map(id => ({ id, status: 'applied' }))
          ]
        }
      );
    }
    if (existing) {
      magicRoleIds.push(existing.id);
      const body = {};
      if (existing.name !== definition.name) body.name = definition.name;
      if (existing.color !== definition.color) body.color = definition.color;
      try {
        if (iconLoader && existing.icon !== expectedRoleIcons[existing.id]) {
          body.icon = toDataUri(await iconLoader(definition.iconKey));
          body.unicode_emoji = null;
        }
        if (Object.keys(body).length > 0) {
          await rest.patch(Routes.guildRole(snapshot.guild.id, existing.id), {
            body,
            reason: '悠の学园都市主题：修复魔法成长角色图标'
          });
          updatedIds.push(existing.id);
        }
      } catch {
        throw new ThemePhaseError(
          'magic-growth-roles',
          definitions.slice(index).map(({ key }) => key),
          {
            completedResults: [
              ...createdIds.map(id => ({ id, status: 'created' })),
              ...updatedIds.map(id => ({ id, status: 'applied' }))
            ]
          }
        );
      }
      continue;
    }

    const body = {
      name: definition.name,
      color: definition.color,
      permissions: definition.permissions
    };
    try {
      if (iconLoader && definition.iconKey) {
        body.icon = toDataUri(await iconLoader(definition.iconKey));
      }
      const created = await rest.post(Routes.guildRoles(snapshot.guild.id), {
        body,
        reason: '悠の学园都市主题：创建魔法成长角色'
      });
      magicRoleIds.push(created.id);
      createdIds.push(created.id);
    } catch {
      throw new ThemePhaseError(
        'magic-growth-roles',
        definitions.slice(index).map(({ key }) => key),
        { completedResults: createdIds.map(id => ({ id, status: 'created' })) }
      );
    }
  }

  return { magicRoleIds, createdIds, updatedIds };
}

async function applyChannelPatches(rest, plan) {
  const results = [];
  for (let index = 0; index < plan.channelPatches.length; index += 1) {
    const patch = plan.channelPatches[index];
    const body = {};
    if (Object.hasOwn(patch, 'name')) body.name = patch.name;
    if (Object.hasOwn(patch, 'topic')) body.topic = patch.topic;
    try {
      await rest.patch(Routes.channel(patch.id), {
        body,
        reason: '悠の学园都市主题：更新频道外观'
      });
      results.push({ id: patch.id, status: 'applied' });
    } catch {
      throw new ThemePhaseError(
        'channels',
        plan.channelPatches.slice(index).map(({ id }) => id),
        { completedResults: results }
      );
    }
  }
  return results;
}

async function applyGrowthRolePatches(rest, plan, iconLoader = null, guildId = TARGET_GUILD_ID) {
  const results = [];
  for (let index = 0; index < plan.growthRolePatches.length; index += 1) {
    const patch = plan.growthRolePatches[index];
    const body = {};
    if (Object.hasOwn(patch, 'name')) body.name = patch.name;
    if (Object.hasOwn(patch, 'color')) body.color = patch.color;
    try {
      if (iconLoader && patch.iconKey) {
        body.icon = toDataUri(await iconLoader(patch.iconKey));
        body.unicode_emoji = null;
      }
      await rest.patch(Routes.guildRole(guildId, patch.id), {
        body,
        reason: '悠の学园都市主题：更新成长角色外观'
      });
      results.push({ id: patch.id, status: 'applied' });
    } catch {
      throw new ThemePhaseError(
        'growth-roles',
        plan.growthRolePatches.slice(index).map(({ id }) => id),
        { completedResults: results }
      );
    }
  }
  return results;
}

async function applyGuildAssets(rest, guildId, assets) {
  const body = {};
  for (const kind of ['icon', 'banner', 'splash']) {
    if (Object.hasOwn(assets, kind)) body[kind] = toDataUri(assets[kind]);
  }
  try {
    await rest.patch(Routes.guild(guildId), {
      body,
      reason: '悠の学园都市主题：更新服务器主视觉'
    });
    return { id: guildId, status: 'applied' };
  } catch {
    throw new ThemePhaseError('guild-assets', [guildId]);
  }
}

async function upsertWelcomeMessage(rest, channelId, payload, existingMessageId = null) {
  if (existingMessageId) {
    try {
      await rest.patch(Routes.channelMessage(channelId, existingMessageId), { body: payload });
      return { messageId: existingMessageId, action: 'updated' };
    } catch (error) {
      if (error.code !== 10008 && error.status !== 404) throw error;
    }
  }

  const currentUser = await rest.get(Routes.user('@me'));
  let before = null;
  let markerMessage = null;
  while (!markerMessage) {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);
    const messages = await rest.get(Routes.channelMessages(channelId), { query });
    markerMessage = messages.find(message =>
      message.author?.id === currentUser.id &&
      message.author?.bot === true &&
      message.embeds?.some(embed => embed.footer?.text?.includes('INDEX_THEME_WELCOME_V1'))
    );
    if (markerMessage || messages.length < 100) break;
    const nextBefore = messages.at(-1)?.id;
    if (!nextBefore || nextBefore === before) break;
    before = nextBefore;
  }
  if (markerMessage) {
    await rest.patch(Routes.channelMessage(channelId, markerMessage.id), { body: payload });
    return { messageId: markerMessage.id, action: 'updated' };
  }
  const message = await rest.post(Routes.channelMessages(channelId), { body: payload });
  return { messageId: message.id, action: 'created' };
}

async function rollbackTheme(rest, beforeSnapshot, currentSnapshot) {
  const results = [];
  for (const change of GROWTH_ROLE_CHANGES) {
    const beforeRole = beforeSnapshot.roles.find(({ id }) => id === change.id);
    if (beforeRole?.icon && !beforeSnapshot.roleIconAssets?.[change.id]) {
      throw new ThemePhaseError('rollback', [change.id]);
    }
  }
  const currentChannels = new Map(currentSnapshot.channels.map(channel => [channel.id, channel]));
  const beforeChannels = new Map(beforeSnapshot.channels.map(channel => [channel.id, channel]));
  for (let index = 0; index < CHANNEL_CHANGES.length; index += 1) {
    const change = CHANNEL_CHANGES[index];
    const before = beforeChannels.get(change.id);
    const current = currentChannels.get(change.id);
    if (!before || !current) continue;
    const body = {};
    if (before.name !== current.name) body.name = before.name;
    if (before.topic !== current.topic) body.topic = before.topic;
    if (Object.keys(body).length === 0) continue;
    try {
      await rest.patch(Routes.channel(change.id), {
        body,
        reason: '悠の学园都市主题：回滚频道外观'
      });
      results.push({ id: change.id, status: 'restored' });
    } catch {
      throw new ThemePhaseError(
        'rollback',
        CHANNEL_CHANGES.slice(index).map(({ id }) => id),
        { completedResults: results }
      );
    }
  }

  const currentRoles = new Map(currentSnapshot.roles.map(role => [role.id, role]));
  const beforeRoles = new Map(beforeSnapshot.roles.map(role => [role.id, role]));
  for (let index = 0; index < GROWTH_ROLE_CHANGES.length; index += 1) {
    const change = GROWTH_ROLE_CHANGES[index];
    const before = beforeRoles.get(change.id);
    const current = currentRoles.get(change.id);
    if (!before || !current) continue;
    const body = {};
    if (before.name !== current.name) body.name = before.name;
    if (before.color !== current.color) body.color = before.color;
    if (before.icon !== current.icon || before.unicodeEmoji !== current.unicodeEmoji) {
      body.icon = before.icon ? beforeSnapshot.roleIconAssets[change.id] : null;
      body.unicode_emoji = before.unicodeEmoji ?? null;
    }
    if (Object.keys(body).length === 0) continue;
    try {
      await rest.patch(Routes.guildRole(currentSnapshot.guild.id, change.id), {
        body,
        reason: '悠の学园都市主题：回滚成长角色外观'
      });
      results.push({ id: change.id, status: 'restored' });
    } catch {
      throw new ThemePhaseError(
        'rollback',
        GROWTH_ROLE_CHANGES.slice(index).map(({ id }) => id),
        { completedResults: results }
      );
    }
  }

  if (beforeSnapshot.guildAssets) {
    try {
      const assetResult = await applyGuildAssets(
        rest,
        currentSnapshot.guild.id,
        beforeSnapshot.guildAssets
      );
      results.push({ ...assetResult, status: 'restored' });
    } catch {
      throw new ThemePhaseError('rollback', [currentSnapshot.guild.id], { completedResults: results });
    }
  }

  return results;
}

function stableOverwrites(channel) {
  return [...(channel.permissionOverwrites || [])]
    .map(overwrite => ({
      id: overwrite.id,
      type: Number(overwrite.type),
      allow: asPermissionString(overwrite.allow),
      deny: asPermissionString(overwrite.deny)
    }))
    .sort((first, second) => `${first.type}:${first.id}`.localeCompare(`${second.type}:${second.id}`));
}

function stableChannelOrder(channels, allowedIds) {
  const groups = new Map();
  for (const channel of channels) {
    if (!allowedIds.has(channel.id)) continue;
    const parentKey = channel.parentId ?? '__root__';
    if (!groups.has(parentKey)) groups.set(parentKey, []);
    groups.get(parentKey).push(channel);
  }
  return [...groups.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([parentId, members]) => ({
      parentId,
      ids: members
        .sort((first, second) => first.position - second.position || first.id.localeCompare(second.id))
        .map(({ id }) => id)
    }));
}

function compareRolePosition(first, second) {
  return first.position - second.position || first.id.localeCompare(second.id);
}

function verifyThemeTerminalState(snapshot, expectedRoleIcons, magicGrowthRoleIds = []) {
  const errors = [];
  const channels = new Map(snapshot.channels.map(channel => [channel.id, channel]));
  for (const change of CHANNEL_CHANGES) {
    const channel = channels.get(change.id);
    if (!channel) continue;
    if (channel.name !== change.name || (Object.hasOwn(change, 'topic') && channel.topic !== change.topic)) {
      errors.push(`频道 ${change.id} 未达到主题终态`);
    }
  }

  const roles = new Map(snapshot.roles.map(role => [role.id, role]));
  for (const change of GROWTH_ROLE_CHANGES) {
    const role = roles.get(change.id);
    if (!role) continue;
    if (role.name !== change.name || role.color !== change.color) {
      errors.push(`成长角色 ${change.id} 未达到主题终态`);
    }
    if (!expectedRoleIcons[role.id]) errors.push(`成长角色 ${change.id} 缺少图标校验基准`);
    else if (role.icon !== expectedRoleIcons[role.id]) errors.push(`成长角色 ${change.id} 图标不匹配`);
  }

  for (const definition of IDENTITY_ROLE_DEFINITIONS) {
    const matches = snapshot.roles.filter(role => role.name === definition.name);
    if (matches.length !== 1) {
      errors.push(`身份角色「${definition.name}」未达到主题终态`);
      continue;
    }
    const [role] = matches;
    if (role.color !== definition.color || role.permissions !== definition.permissions || role.managed !== false) {
      errors.push(`身份角色「${definition.name}」属性未达到主题终态`);
    }
    if (!expectedRoleIcons[role.id]) errors.push(`身份角色「${definition.name}」缺少图标校验基准`);
    else if (role.icon !== expectedRoleIcons[role.id]) errors.push(`身份角色「${definition.name}」图标不匹配`);
  }

  for (const [index, definition] of MAGIC_GROWTH_ROLE_DEFINITIONS.entries()) {
    const stableRoleId = magicGrowthRoleIds[index] || null;
    const matches = stableRoleId
      ? snapshot.roles.filter(role => role.id === stableRoleId)
      : snapshot.roles.filter(role => role.name === definition.name);
    if (matches.length !== 1) {
      errors.push(`魔法成长角色「${definition.name}」未达到主题终态`);
      continue;
    }
    const [role] = matches;
    if (
      role.name !== definition.name ||
      role.color !== definition.color ||
      role.permissions !== definition.permissions ||
      role.managed !== false
    ) {
      errors.push(`魔法成长角色「${definition.name}」属性未达到主题终态`);
    }
    if (!expectedRoleIcons[role.id]) errors.push(`魔法成长角色「${definition.name}」缺少图标校验基准`);
    else if (role.icon !== expectedRoleIcons[role.id]) errors.push(`魔法成长角色「${definition.name}」图标不匹配`);
  }

  for (const [field, label] of [
    ['icon', '服务器图标'],
    ['banner', '服务器横幅'],
    ['splash', '邀请背景']
  ]) {
    if (!snapshot.guild[field]) errors.push(`${label}未达到主题终态`);
  }
  return errors;
}

function verifyThemeTransition(
  beforeSnapshot,
  afterSnapshot,
  expectedRoleIcons = {},
  magicGrowthRoleIds = []
) {
  const errors = [];
  if (beforeSnapshot.guild.id !== afterSnapshot.guild.id) errors.push('服务器 ID 发生变化');
  if (beforeSnapshot.guild.name !== afterSnapshot.guild.name) errors.push('服务器名称发生未批准变化');
  if (beforeSnapshot.guild.ownerId !== afterSnapshot.guild.ownerId) errors.push('服务器所有者发生变化');

  const beforeChannels = new Map(beforeSnapshot.channels.map(channel => [channel.id, channel]));
  const afterChannels = new Map(afterSnapshot.channels.map(channel => [channel.id, channel]));
  if (beforeChannels.size !== afterChannels.size) errors.push('频道数量发生变化');
  const channelChangeIds = new Set(CHANNEL_CHANGES.map(({ id }) => id));
  for (const [id, before] of beforeChannels) {
    const after = afterChannels.get(id);
    if (!after) {
      errors.push(`频道集合缺少 ${id}`);
      continue;
    }
    if (before.type !== after.type) errors.push(`频道 ${id} 类型发生变化`);
    if (before.parentId !== after.parentId) errors.push(`频道 ${id} 父分类发生变化`);
    if (JSON.stringify(stableOverwrites(before)) !== JSON.stringify(stableOverwrites(after))) {
      errors.push(`频道 ${id} 权限覆盖发生变化`);
    }
    if (!channelChangeIds.has(id) && (before.name !== after.name || before.topic !== after.topic)) {
      errors.push(`无关频道 ${id} 外观发生变化`);
    }
  }
  for (const id of afterChannels.keys()) {
    if (!beforeChannels.has(id)) errors.push(`频道集合新增 ${id}`);
  }
  const existingChannelIds = new Set(
    [...beforeChannels.keys()].filter(id => afterChannels.has(id))
  );
  if (
    JSON.stringify(stableChannelOrder(beforeSnapshot.channels, existingChannelIds)) !==
    JSON.stringify(stableChannelOrder(afterSnapshot.channels, existingChannelIds))
  ) {
    errors.push('频道排序发生变化');
  }

  const beforeRoles = new Map(beforeSnapshot.roles.map(role => [role.id, role]));
  const afterRoles = new Map(afterSnapshot.roles.map(role => [role.id, role]));
  const magicGrowthNames = new Set(MAGIC_GROWTH_ROLE_DEFINITIONS.map(({ name }) => name));
  const growthIds = new Set(GROWTH_ROLE_CHANGES.map(({ id }) => id));
  if (magicGrowthRoleIds.length > 0) {
    for (const roleId of magicGrowthRoleIds) growthIds.add(roleId);
  } else {
    for (const role of beforeSnapshot.roles) {
      if (magicGrowthNames.has(role.name)) growthIds.add(role.id);
    }
  }
  const approvedNewRoleNames = new Set([
    ...IDENTITY_ROLE_DEFINITIONS.map(({ name }) => name),
    ...magicGrowthNames
  ]);
  for (const [id, before] of beforeRoles) {
    const after = afterRoles.get(id);
    if (!after) {
      errors.push(`角色集合缺少 ${id}`);
      continue;
    }
    if (before.permissions !== after.permissions) errors.push(`角色 ${id} 权限发生变化`);
    if (before.managed !== after.managed) errors.push(`角色 ${id} 托管状态发生变化`);
    const themedRole = approvedNewRoleNames.has(before.name);
    if (!growthIds.has(id) && !themedRole) {
      for (const field of ['name', 'color', 'icon', 'unicodeEmoji']) {
        if (before[field] !== after[field]) errors.push(`无关角色 ${id} 的 ${field} 发生变化`);
      }
    }
  }
  for (const [id, role] of afterRoles) {
    if (beforeRoles.has(id)) continue;
    if (!approvedNewRoleNames.has(role.name) || role.permissions !== '0' || role.managed !== false) {
      errors.push(`角色集合新增未批准角色 ${id}`);
    }
  }
  const existingBeforeOrder = beforeSnapshot.roles
    .filter(role => afterRoles.has(role.id) && role.id !== THEME_BOT_ROLE_ID)
    .sort(compareRolePosition)
    .map(({ id }) => id);
  const existingAfterOrder = afterSnapshot.roles
    .filter(role => beforeRoles.has(role.id) && role.id !== THEME_BOT_ROLE_ID)
    .sort(compareRolePosition)
    .map(({ id }) => id);
  if (JSON.stringify(existingBeforeOrder) !== JSON.stringify(existingAfterOrder)) {
    errors.push('既有角色层级顺序发生变化');
  }

  const beforeBotRole = beforeRoles.get(THEME_BOT_ROLE_ID);
  const afterBotRole = afterRoles.get(THEME_BOT_ROLE_ID);
  if (beforeBotRole && afterBotRole) {
    const growthRolesAboveBot = [...growthIds]
      .map(id => afterRoles.get(id))
      .filter(Boolean)
      .some(role => compareRolePosition(afterBotRole, role) <= 0);
    if (growthRolesAboveBot) errors.push('机器人角色未位于全部成长角色之上');

    const crossedUnrelatedRole = beforeSnapshot.roles
      .filter(role => role.id !== THEME_BOT_ROLE_ID && !growthIds.has(role.id) && afterRoles.has(role.id))
      .some(role => {
        const afterRole = afterRoles.get(role.id);
        return Math.sign(compareRolePosition(beforeBotRole, role)) !==
          Math.sign(compareRolePosition(afterBotRole, afterRole));
      });
    if (crossedUnrelatedRole) errors.push('机器人角色与无关既有角色的层级顺序发生变化');
  }

  const afterValidation = validateThemeSnapshot(afterSnapshot, magicGrowthRoleIds);
  errors.push(...afterValidation.errors.map(error => `实施后校验：${error}`));
  errors.push(...verifyThemeTerminalState(afterSnapshot, expectedRoleIcons, magicGrowthRoleIds));
  return { ok: errors.length === 0, errors };
}

function assertRollbackSnapshot(snapshot, guildId = TARGET_GUILD_ID) {
  if (snapshot?.guild?.id !== guildId) {
    throw new Error('回滚快照不属于已确认的目标服务器');
  }
  const validation = validateThemeSnapshot(snapshot);
  if (!validation.ok) {
    throw new Error(`回滚快照校验失败：\n- ${validation.errors.join('\n- ')}`);
  }
}

async function runThemeApplyPhase({
  rest,
  guildId = TARGET_GUILD_ID,
  confirmGuild,
  phase,
  backupDirectory,
  clock = () => new Date(),
  assetFetcher,
  iconLoader = null,
  assets = null,
  welcomeChannelId = null,
  welcomePayload = null,
  existingMessageId = null,
  expectedRoleIcons = {},
  magicGrowthRoleIds = []
}) {
  assertApplyConfirmation(confirmGuild, guildId);
  const phases = new Set(['identity-roles', 'magic-growth-roles', 'channels', 'growth-roles', 'guild-assets', 'welcome']);
  if (!phases.has(phase)) throw new Error(`未知主题阶段：${phase}`);
  const snapshot = await fetchThemeSnapshot(rest, guildId);
  const plan = buildThemePlan(snapshot, expectedRoleIcons, magicGrowthRoleIds);
  const preflight = await fetchThemePreflight(rest, snapshot, plan);
  assertPhaseReady(preflight, phase);
  const backup = await saveThemeSnapshotBundle(snapshot, backupDirectory, clock, assetFetcher);

  let result;
  try {
    if (phase === 'identity-roles') {
      result = await ensureIdentityRoles(
        rest,
        snapshot,
        IDENTITY_ROLE_DEFINITIONS,
        iconLoader,
        expectedRoleIcons
      );
    } else if (phase === 'magic-growth-roles') {
      result = await ensureMagicGrowthRoles(
        rest,
        snapshot,
        MAGIC_GROWTH_ROLE_DEFINITIONS,
        iconLoader,
        expectedRoleIcons,
        magicGrowthRoleIds
      );
    } else if (phase === 'channels') {
      result = await applyChannelPatches(rest, plan);
    } else if (phase === 'growth-roles') {
      result = await applyGrowthRolePatches(rest, plan, iconLoader, guildId);
    } else if (phase === 'guild-assets') {
      if (!assets) throw new Error('guild-assets 阶段缺少素材');
      result = await applyGuildAssets(rest, guildId, assets);
    } else if (phase === 'welcome') {
      if (!welcomeChannelId || !welcomePayload) throw new Error('welcome 阶段缺少频道或消息内容');
      result = await upsertWelcomeMessage(rest, welcomeChannelId, welcomePayload, existingMessageId);
    }
  } catch (error) {
    if (error instanceof ThemePhaseError) error.snapshotPath = backup.manifestPath;
    throw error;
  }

  return { snapshotPath: backup.manifestPath, plan, preflight, result };
}

module.exports = {
  ThemePhaseError,
  fetchThemeSnapshot,
  createAssetFetcher,
  saveThemeSnapshotBundle,
  dryRunTheme,
  evaluateThemePreflight,
  fetchThemePreflight,
  assertPhaseReady,
  assertApplyConfirmation,
  ensureIdentityRoles,
  ensureMagicGrowthRoles,
  applyChannelPatches,
  applyGrowthRolePatches,
  applyGuildAssets,
  upsertWelcomeMessage,
  rollbackTheme,
  verifyThemeTransition,
  assertRollbackSnapshot,
  runThemeApplyPhase
};

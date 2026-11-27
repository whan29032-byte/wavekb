'use strict';

const path = require('node:path');

const DEFAULT_WELCOME_CHANNEL_ID = '1545734710888632411';

function normalize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireValue(env, name) {
  const value = normalize(env[name]);
  if (!value) {
    throw new Error(`缺少必需的环境变量：${name}`);
  }
  return value;
}

function optionalProxyUrl(value) {
  const proxyUrl = normalize(value);
  if (!proxyUrl) return null;

  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new Error('PROXY_URL 必须是有效的网址');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('PROXY_URL 必须使用 http:// 或 https://');
  }
  return proxyUrl;
}

function optionalRouteRoles(env) {
  const names = ['SCIENCE_ROLE_ID', 'MAGIC_ROLE_ID'];
  const values = Object.fromEntries(names.map(name => [name, normalize(env[name])]));
  const configuredCount = names.filter(name => values[name]).length;

  if (configuredCount === 0) return null;
  const guildId = normalize(env.THEME_GUILD_ID);
  if (configuredCount !== names.length || !guildId) {
    throw new Error(`路线角色配置必须同时填写：THEME_GUILD_ID、${names.join('、')}`);
  }
  if (values.SCIENCE_ROLE_ID === values.MAGIC_ROLE_ID) {
    throw new Error('SCIENCE_ROLE_ID 与 MAGIC_ROLE_ID 不能相同');
  }

  return {
    guildId,
    esperRoleId: values.SCIENCE_ROLE_ID,
    magicianRoleId: values.MAGIC_ROLE_ID
  };
}

function parseGrowthRoleIds(value, name) {
  const normalized = normalize(value);
  if (!normalized) return null;
  const roleIds = normalized.split(',').map(roleId => roleId.trim()).filter(Boolean);
  if (roleIds.length !== 6) throw new Error(`${name} 成长角色必须恰好填写 6 个 ID`);
  return roleIds;
}

function optionalGrowthRoles(env) {
  const esperRoleIds = parseGrowthRoleIds(env.SCIENCE_GROWTH_ROLE_IDS, 'SCIENCE_GROWTH_ROLE_IDS');
  const magicianRoleIds = parseGrowthRoleIds(env.MAGIC_GROWTH_ROLE_IDS, 'MAGIC_GROWTH_ROLE_IDS');
  if (!esperRoleIds && !magicianRoleIds) return null;
  const guildId = normalize(env.THEME_GUILD_ID);
  if (!esperRoleIds || !magicianRoleIds || !guildId) {
    throw new Error('成长角色配置必须同时填写：THEME_GUILD_ID、SCIENCE_GROWTH_ROLE_IDS、MAGIC_GROWTH_ROLE_IDS');
  }
  const allRoleIds = [...esperRoleIds, ...magicianRoleIds];
  if (new Set(allRoleIds).size !== allRoleIds.length) {
    throw new Error('成长角色 ID 不能重复');
  }
  return { guildId, esperRoleIds, magicianRoleIds };
}

function isDiscordSnowflake(value) {
  return /^[0-9]{17,20}$/.test(value);
}

function websiteOrigin(value, name) {
  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`${name} 必须是有效的 HTTP(S) 网站来源`);
  }
  if (
    !['http:', 'https:'].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.pathname !== '/' ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error(`${name} 必须是有效的 HTTP(S) 网站来源`);
  }
  return parsedUrl.origin;
}

function optionalWebsiteIntegration(env) {
  const apiUrl = normalize(env.WEBSITE_API_URL);
  const publicUrl = normalize(env.WEBSITE_PUBLIC_URL);
  const apiSecret = normalize(env.WEBSITE_BOT_API_SECRET);
  const guildId = normalize(env.WEBSITE_GUILD_ID);
  const linkedRoleId = normalize(env.WEBSITE_LINKED_ROLE_ID);
  const titleRoleMapText = normalize(env.WEBSITE_TITLE_ROLE_MAP);
  const required = [apiUrl, apiSecret, guildId];
  const configuredCount = required.filter(Boolean).length;

  if (configuredCount === 0 && !publicUrl && !linkedRoleId && !titleRoleMapText) return null;
  if (configuredCount !== required.length) {
    throw new Error('网站接入配置必须同时填写 WEBSITE_API_URL、WEBSITE_BOT_API_SECRET、WEBSITE_GUILD_ID');
  }
  if (Buffer.byteLength(apiSecret, 'utf8') < 32) {
    throw new Error('WEBSITE_BOT_API_SECRET 必须至少包含 32 个 UTF-8 字节');
  }
  const apiOrigin = websiteOrigin(apiUrl, 'WEBSITE_API_URL');
  const publicOrigin = publicUrl
    ? websiteOrigin(publicUrl, 'WEBSITE_PUBLIC_URL')
    : apiOrigin;
  if (!isDiscordSnowflake(guildId)) {
    throw new Error('WEBSITE_GUILD_ID 必须是有效的 Discord 服务器 ID');
  }
  if (linkedRoleId && !isDiscordSnowflake(linkedRoleId)) {
    throw new Error('WEBSITE_LINKED_ROLE_ID 必须是有效的 Discord 角色 ID');
  }

  let titleRoleMap = {};
  if (titleRoleMapText) {
    try {
      titleRoleMap = JSON.parse(titleRoleMapText);
    } catch {
      throw new Error('WEBSITE_TITLE_ROLE_MAP 必须是有效的 JSON 对象');
    }
    if (!titleRoleMap || Array.isArray(titleRoleMap) || typeof titleRoleMap !== 'object') {
      throw new Error('WEBSITE_TITLE_ROLE_MAP 必须是有效的 JSON 对象');
    }
  }

  const normalizedMap = {};
  for (const [rawTitle, rawRoleId] of Object.entries(titleRoleMap)) {
    const title = normalize(rawTitle);
    const roleId = normalize(rawRoleId);
    if (!title || title.length > 24 || !isDiscordSnowflake(roleId)) {
      throw new Error('WEBSITE_TITLE_ROLE_MAP 的称号和角色 ID 无效');
    }
    normalizedMap[title] = roleId;
  }
  const roleIds = Object.values(normalizedMap);
  if (new Set(roleIds).size !== roleIds.length || (linkedRoleId && roleIds.includes(linkedRoleId))) {
    throw new Error('WEBSITE_TITLE_ROLE_MAP 与 WEBSITE_LINKED_ROLE_ID 的角色 ID 不能重复');
  }

  return {
    apiUrl: apiOrigin,
    publicUrl: publicOrigin,
    apiSecret,
    guildId,
    linkedRoleId: linkedRoleId || null,
    titleRoleMap: normalizedMap
  };
}

function loadConfig(env = process.env, baseDir = __dirname) {
  const token = requireValue(env, 'TOKEN');
  const clientId = requireValue(env, 'CLIENT_ID');
  const guildId = normalize(env.GUILD_ID) || null;
  const proxyUrl = optionalProxyUrl(env.PROXY_URL);
  const databasePath = normalize(env.DATABASE_PATH) || 'data/profile-bot.db';
  const welcomeChannelId = normalize(env.WELCOME_CHANNEL_ID) || DEFAULT_WELCOME_CHANNEL_ID;
  const routeRoles = optionalRouteRoles(env);
  const growthRoles = optionalGrowthRoles(env);
  const websiteIntegration = optionalWebsiteIntegration(env);
  if (routeRoles && growthRoles) {
    const identityRoleIds = new Set([routeRoles.esperRoleId, routeRoles.magicianRoleId]);
    const overlapsGrowthRole = [
      ...growthRoles.esperRoleIds,
      ...growthRoles.magicianRoleIds
    ].some(roleId => identityRoleIds.has(roleId));
    if (overlapsGrowthRole) {
      throw new Error('身份角色 ID 不能与成长角色 ID 重复');
    }
  }
  if (websiteIntegration) {
    const protectedRoleIds = new Set();
    if (routeRoles) {
      protectedRoleIds.add(routeRoles.esperRoleId);
      protectedRoleIds.add(routeRoles.magicianRoleId);
    }
    if (growthRoles) {
      for (const roleId of growthRoles.esperRoleIds) protectedRoleIds.add(roleId);
      for (const roleId of growthRoles.magicianRoleIds) protectedRoleIds.add(roleId);
    }
    const websiteRoleIds = [
      websiteIntegration.linkedRoleId,
      ...Object.values(websiteIntegration.titleRoleMap)
    ].filter(Boolean);
    if (websiteRoleIds.some(roleId => protectedRoleIds.has(roleId))) {
      throw new Error('WEBSITE 网站角色 ID 不能与身份角色或成长角色 ID 重复');
    }
  }

  return {
    token,
    clientId,
    guildId,
    proxyUrl,
    databasePath: path.resolve(baseDir, databasePath),
    welcomeChannelId,
    routeRoles,
    growthRoles,
    websiteIntegration,
    backgroundPaths: {
      esper: path.resolve(baseDir, 'assets/bg-esper.png'),
      magician: path.resolve(baseDir, 'assets/bg-magician.png')
    }
  };
}

module.exports = { loadConfig };

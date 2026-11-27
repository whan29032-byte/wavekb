import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const INVALID_PAYLOAD = 'Invalid Discord bot runtime payload.';
const MAX_DATABASE_BYTES = 1024 * 1024;
const REQUIRED_KEYS = [
  'clientId',
  'guildId',
  'magicGrowthRoleIds',
  'magicRoleId',
  'scienceGrowthRoleIds',
  'scienceRoleId',
  'themeGuildId',
  'token',
  'websiteApiSecret',
  'websiteApiUrl',
  'websiteGuildId',
  'websitePublicUrl',
];
const OPTIONAL_KEYS = ['databaseBase64'];

function invalidPayload() {
  throw new Error(INVALID_PAYLOAD);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isSnowflake(value) {
  return typeof value === 'string' && /^[0-9]{17,20}$/.test(value);
}

function isDiscordToken(value) {
  return typeof value === 'string'
    && value.length >= 50
    && value.length <= 128
    && /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}$/.test(value);
}

function isWebsiteSecret(value) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= 32
    && Buffer.byteLength(value, 'utf8') <= 128
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function isHttpsOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.origin === value
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === '';
  } catch {
    return false;
  }
}

function validateGrowthRoles(value) {
  return Array.isArray(value)
    && value.length === 6
    && value.every(isSnowflake)
    && new Set(value).size === value.length;
}

function decodeDatabase(value) {
  if (value === undefined) return null;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > Math.ceil(MAX_DATABASE_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) invalidPayload();

  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length === 0
    || decoded.length > MAX_DATABASE_BYTES
    || decoded.toString('base64') !== value
    || !decoded.subarray(0, 16).equals(Buffer.from('SQLite format 3\0', 'binary'))
  ) invalidPayload();
  return decoded;
}

export function renderDiscordBotEnvironment(payload) {
  if (!isPlainObject(payload)) invalidPayload();
  const keys = Object.keys(payload).sort();
  const allowedKeys = [...REQUIRED_KEYS, ...OPTIONAL_KEYS].sort();
  if (
    REQUIRED_KEYS.some(key => !Object.hasOwn(payload, key))
    || keys.some(key => !allowedKeys.includes(key))
  ) invalidPayload();

  if (
    !isDiscordToken(payload.token)
    || !isWebsiteSecret(payload.websiteApiSecret)
    || !isSnowflake(payload.clientId)
    || !isSnowflake(payload.guildId)
    || !isSnowflake(payload.themeGuildId)
    || !isSnowflake(payload.scienceRoleId)
    || !isSnowflake(payload.magicRoleId)
    || !isSnowflake(payload.websiteGuildId)
    || !validateGrowthRoles(payload.scienceGrowthRoleIds)
    || !validateGrowthRoles(payload.magicGrowthRoleIds)
    || !isHttpsOrigin(payload.websiteApiUrl)
    || !isHttpsOrigin(payload.websitePublicUrl)
  ) invalidPayload();

  const roleIds = [
    payload.scienceRoleId,
    payload.magicRoleId,
    ...payload.scienceGrowthRoleIds,
    ...payload.magicGrowthRoleIds,
  ];
  if (new Set(roleIds).size !== roleIds.length) invalidPayload();

  const databaseBuffer = decodeDatabase(payload.databaseBase64);
  const environmentText = [
    `TOKEN=${payload.token}`,
    `CLIENT_ID=${payload.clientId}`,
    `GUILD_ID=${payload.guildId}`,
    'DATABASE_PATH=/var/lib/elliott-wave-discord-bot/profile-bot.db',
    `THEME_GUILD_ID=${payload.themeGuildId}`,
    `SCIENCE_ROLE_ID=${payload.scienceRoleId}`,
    `MAGIC_ROLE_ID=${payload.magicRoleId}`,
    `SCIENCE_GROWTH_ROLE_IDS=${payload.scienceGrowthRoleIds.join(',')}`,
    `MAGIC_GROWTH_ROLE_IDS=${payload.magicGrowthRoleIds.join(',')}`,
    `WEBSITE_API_URL=${payload.websiteApiUrl}`,
    `WEBSITE_PUBLIC_URL=${payload.websitePublicUrl}`,
    `WEBSITE_BOT_API_SECRET=${payload.websiteApiSecret}`,
    `WEBSITE_GUILD_ID=${payload.websiteGuildId}`,
    '',
  ].join('\n');

  return { environmentText, databaseBuffer };
}

function runCli(argv) {
  if (argv.length !== 3) invalidPayload();
  const [payloadPath, environmentPath, databasePath] = argv;
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const rendered = renderDiscordBotEnvironment(payload);
  fs.writeFileSync(environmentPath, rendered.environmentText, { flag: 'wx', mode: 0o600 });
  if (rendered.databaseBuffer !== null) {
    fs.writeFileSync(databasePath, rendered.databaseBuffer, { flag: 'wx', mode: 0o600 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli(process.argv.slice(2));
  } catch {
    console.error(INVALID_PAYLOAD);
    process.exitCode = 1;
  }
}

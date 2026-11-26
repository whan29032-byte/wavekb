'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { REST } = require('discord.js');
const { loadConfig } = require('../config');
const { configureProxy, applyRestAgent } = require('../network');
const {
  TARGET_GUILD_ID,
  buildWelcomePayload,
  buildThemePlan
} = require('../server-theme');
const {
  ThemePhaseError,
  fetchThemeSnapshot,
  createAssetFetcher,
  saveThemeSnapshotBundle,
  dryRunTheme,
  runThemeApplyPhase,
  assertApplyConfirmation,
  rollbackTheme,
  verifyThemeTransition,
  assertRollbackSnapshot
} = require('../server-theme-manager');
const { GROWTH_ROLE_CHANGES } = require('../server-theme');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIRECTORY = path.join(ROOT, 'data', 'server-theme-backups');
const STATE_PATH = path.join(ROOT, 'data', 'server-theme-state.json');
const THEME_ASSET_DIRECTORY = path.join(ROOT, 'assets', 'theme');
const WELCOME_CHANNEL_ID = '1545734710888632411';

function printHelp() {
  console.log(`悠の学园都市安全主题管理器

默认不写入：无参数只显示本帮助。

只读操作：
  snapshot
  dry-run
  verify --before <manifest.json>

分阶段写入（必须精确确认服务器）：
  apply identity-roles --confirm-guild ${TARGET_GUILD_ID}
  apply magic-growth-roles --confirm-guild ${TARGET_GUILD_ID}
  apply channels       --confirm-guild ${TARGET_GUILD_ID}
  apply growth-roles   --confirm-guild ${TARGET_GUILD_ID}
  apply guild-assets   --confirm-guild ${TARGET_GUILD_ID}
  apply welcome        --confirm-guild ${TARGET_GUILD_ID}

回滚已批准字段：
  rollback --snapshot <manifest.json> --confirm-guild ${TARGET_GUILD_ID}
`);
}

function parseArguments(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[value.slice(2)] = next;
      index += 1;
    } else {
      flags[value.slice(2)] = true;
    }
  }
  return { positional, flags };
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStateAtomic(state, statePath = STATE_PATH) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, statePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function readPngData(iconKey) {
  return fs.readFile(path.join(THEME_ASSET_DIRECTORY, 'role-icons', `${iconKey}.png`));
}

async function readGuildAssets() {
  const [icon, banner, splash] = await Promise.all([
    fs.readFile(path.join(THEME_ASSET_DIRECTORY, 'server-icon.png')),
    fs.readFile(path.join(THEME_ASSET_DIRECTORY, 'server-banner.png')),
    fs.readFile(path.join(THEME_ASSET_DIRECTORY, 'invite-splash.png'))
  ]);
  return { icon, banner, splash };
}

async function loadRollbackAssets(manifestPath, snapshot) {
  const directory = path.dirname(manifestPath);
  const guildAssets = { icon: null, banner: null, splash: null };
  for (const kind of ['icon', 'banner', 'splash']) {
    if (!snapshot.guild[kind]) continue;
    const extension = snapshot.guild[kind].startsWith('a_') ? 'gif' : 'png';
    const data = await fs.readFile(path.join(directory, `${kind}.${extension}`));
    const mime = extension === 'gif' ? 'image/gif' : 'image/png';
    guildAssets[kind] = `data:${mime};base64,${data.toString('base64')}`;
  }
  const roleIconAssets = {};
  const targetRoleIds = new Set(GROWTH_ROLE_CHANGES.map(({ id }) => id));
  for (const role of snapshot.roles) {
    if (!targetRoleIds.has(role.id) || !role.icon) continue;
    const data = await fs.readFile(path.join(directory, `role-${role.id}-icon.png`));
    roleIconAssets[role.id] = `data:image/png;base64,${data.toString('base64')}`;
  }
  return { guildAssets, roleIconAssets };
}

function collectRoleIconHashes(snapshot, roleIds) {
  const ids = new Set(roleIds);
  return Object.fromEntries(
    snapshot.roles
      .filter(role => ids.has(role.id) && role.icon)
      .map(role => [role.id, role.icon])
  );
}

function createRest(config) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const { restAgent } = configureProxy(config.proxyUrl);
  applyRestAgent(rest, restAgent);
  return { rest, assetFetcher: createAssetFetcher(restAgent) };
}

function summarizeResult(operation, payload) {
  console.log(JSON.stringify({ operation, ...payload }, null, 2));
}

async function runCli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArguments(argv);
  if (flags.help || positional.length === 0) {
    printHelp();
    return;
  }

  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const config = loadConfig(process.env, ROOT);
  const { rest, assetFetcher } = createRest(config);
  const operation = positional[0];

  if (operation === 'snapshot') {
    const snapshot = await fetchThemeSnapshot(rest, TARGET_GUILD_ID);
    const bundle = await saveThemeSnapshotBundle(snapshot, BACKUP_DIRECTORY, undefined, assetFetcher);
    summarizeResult('snapshot', {
      status: 'saved',
      snapshotPath: bundle.manifestPath,
      premiumTier: snapshot.guild.premiumTier,
      premiumSubscriptionCount: snapshot.guild.premiumSubscriptionCount,
      channelCount: snapshot.channels.length,
      roleCount: snapshot.roles.length
    });
    return;
  }

  if (operation === 'dry-run') {
    const state = await readState();
    const { plan, preflight } = await dryRunTheme(
      rest,
      TARGET_GUILD_ID,
      state.roleIconHashes || {},
      state.magicGrowthRoles || []
    );
    summarizeResult('dry-run', {
      status: 'read-only',
      channelPatches: plan.channelPatches,
      growthRolePatches: plan.growthRolePatches,
      identityRoles: plan.identityRoles.map(({ key, name, color, permissions }) => ({ key, name, color, permissions })),
      identityRolePatches: plan.identityRolePatches,
      magicGrowthRoles: plan.magicGrowthRoles.map(({ key, name, color, permissions }) => ({ key, name, color, permissions })),
      magicGrowthRolePatches: plan.magicGrowthRolePatches,
      preflight
    });
    return;
  }

  if (operation === 'verify') {
    if (typeof flags.before !== 'string') throw new Error('verify 需要 --before <manifest.json>');
    const beforeSnapshot = JSON.parse(await fs.readFile(path.resolve(flags.before), 'utf8'));
    assertRollbackSnapshot(beforeSnapshot, TARGET_GUILD_ID);
    const state = await readState();
    const afterSnapshot = await fetchThemeSnapshot(rest, TARGET_GUILD_ID);
    const verification = verifyThemeTransition(
      beforeSnapshot,
      afterSnapshot,
      state.roleIconHashes || {},
      state.magicGrowthRoles || []
    );
    summarizeResult('verify', { status: verification.ok ? 'verified' : 'drifted', ...verification });
    if (!verification.ok) process.exitCode = 1;
    return;
  }

  if (operation === 'apply') {
    const phase = positional[1];
    assertApplyConfirmation(flags['confirm-guild'], TARGET_GUILD_ID);
    const state = await readState();
    const options = {
      rest,
      guildId: TARGET_GUILD_ID,
      confirmGuild: flags['confirm-guild'],
      phase,
      backupDirectory: BACKUP_DIRECTORY,
      assetFetcher,
      expectedRoleIcons: state.roleIconHashes || {},
      magicGrowthRoleIds: state.magicGrowthRoles || []
    };
    if (phase === 'identity-roles' || phase === 'magic-growth-roles' || phase === 'growth-roles') {
      options.iconLoader = readPngData;
    } else if (phase === 'guild-assets') {
      options.assets = await readGuildAssets();
    } else if (phase === 'welcome') {
      options.welcomeChannelId = WELCOME_CHANNEL_ID;
      options.welcomePayload = buildWelcomePayload({
        flower: '1545731928861311058',
        tools: '1545734021630132304',
        virtual: '1545782144998051933',
        voice: '1545731928861311057'
      });
      options.existingMessageId = state.welcomeMessageId || null;
    }

    const applied = await runThemeApplyPhase(options);
    if (phase === 'identity-roles') {
      state.routeRoles = applied.result;
      const afterSnapshot = await fetchThemeSnapshot(rest, TARGET_GUILD_ID);
      state.roleIconHashes = {
        ...(state.roleIconHashes || {}),
        ...collectRoleIconHashes(afterSnapshot, [
          applied.result.esperRoleId,
          applied.result.magicianRoleId,
          applied.result.saintRoleId
        ])
      };
      await writeStateAtomic(state);
    } else if (phase === 'magic-growth-roles') {
      state.magicGrowthRoles = applied.result.magicRoleIds;
      const afterSnapshot = await fetchThemeSnapshot(rest, TARGET_GUILD_ID);
      state.roleIconHashes = {
        ...(state.roleIconHashes || {}),
        ...collectRoleIconHashes(afterSnapshot, applied.result.magicRoleIds)
      };
      await writeStateAtomic(state);
    } else if (phase === 'growth-roles') {
      const afterSnapshot = await fetchThemeSnapshot(rest, TARGET_GUILD_ID);
      state.roleIconHashes = {
        ...(state.roleIconHashes || {}),
        ...collectRoleIconHashes(afterSnapshot, GROWTH_ROLE_CHANGES.map(({ id }) => id))
      };
      await writeStateAtomic(state);
    } else if (phase === 'welcome') {
      state.welcomeMessageId = applied.result.messageId;
      await writeStateAtomic(state);
    }
    summarizeResult(`apply ${phase}`, {
      status: 'complete',
      snapshotPath: applied.snapshotPath,
      result: applied.result
    });
    return;
  }

  if (operation === 'rollback') {
    assertApplyConfirmation(flags['confirm-guild'], TARGET_GUILD_ID);
    if (typeof flags.snapshot !== 'string') {
      throw new Error('rollback 需要 --snapshot <manifest.json>');
    }
    const manifestPath = path.resolve(flags.snapshot);
    const beforeSnapshot = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assertRollbackSnapshot(beforeSnapshot, TARGET_GUILD_ID);
    const rollbackAssets = await loadRollbackAssets(manifestPath, beforeSnapshot);
    beforeSnapshot.guildAssets = rollbackAssets.guildAssets;
    beforeSnapshot.roleIconAssets = rollbackAssets.roleIconAssets;
    const currentSnapshot = await fetchThemeSnapshot(rest, TARGET_GUILD_ID);
    buildThemePlan(currentSnapshot);
    const currentBackup = await saveThemeSnapshotBundle(currentSnapshot, BACKUP_DIRECTORY, undefined, assetFetcher);
    let results;
    try {
      results = await rollbackTheme(rest, beforeSnapshot, currentSnapshot);
    } catch (error) {
      if (error instanceof ThemePhaseError) error.snapshotPath = currentBackup.manifestPath;
      throw error;
    }
    const state = await readState();
    state.roleIconHashes = {};
    await writeStateAtomic(state);
    summarizeResult('rollback', {
      status: 'complete',
      snapshotPath: currentBackup.manifestPath,
      result: results
    });
    return;
  }

  throw new Error(`未知操作：${positional.join(' ')}`);
}

if (require.main === module) {
  runCli().catch(error => {
    if (error instanceof ThemePhaseError) {
      console.error(JSON.stringify({
        status: 'blocked',
        phase: error.phase,
        blockedIds: error.blockedIds,
        completedResults: error.completedResults,
        snapshotPath: error.snapshotPath
      }));
    } else {
      console.error(`主题管理失败：${error.message}`);
    }
    process.exitCode = 1;
  });
}

module.exports = { runCli, parseArguments, printHelp, writeStateAtomic };

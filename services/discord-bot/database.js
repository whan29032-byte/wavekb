'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { applyXp } = require('./progression');

const MESSAGE_XP_COOLDOWN_MS = 60_000;
const PATH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;
const LEGACY_GUILD_ID = '__legacy_global__';

const CREATE_USERS_TABLE = `
  CREATE TABLE users (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT 'esper',
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    xp_needed INTEGER NOT NULL DEFAULT 100,
    total_xp INTEGER NOT NULL DEFAULT 0,
    ability_name TEXT NOT NULL DEFAULT '未设置',
    chant TEXT NOT NULL DEFAULT '未设置',
    last_path_change INTEGER NOT NULL DEFAULT 0,
    last_xp_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )
`;

function migrateSchema(connection) {
  const tableExists = connection.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'
  `).get();

  if (!tableExists) {
    connection.exec(CREATE_USERS_TABLE);
    connection.pragma('user_version = 2');
    return;
  }

  const columns = connection.pragma('table_info(users)');
  const columnNames = new Set(columns.map(column => column.name));

  if (!columnNames.has('guild_id')) {
    const lastXpExpression = columnNames.has('last_xp_at')
      ? 'COALESCE(last_xp_at, 0)'
      : '0';
    connection.transaction(() => {
      connection.exec('ALTER TABLE users RENAME TO users_legacy');
      connection.exec(CREATE_USERS_TABLE);
      connection.exec(`
        INSERT INTO users (
          guild_id, user_id, path, level, xp, xp_needed, total_xp,
          ability_name, chant, last_path_change, last_xp_at
        )
        SELECT
          '${LEGACY_GUILD_ID}', user_id, COALESCE(path, 'esper'),
          COALESCE(level, 1), COALESCE(xp, 0), COALESCE(xp_needed, 100),
          COALESCE(total_xp, 0), COALESCE(ability_name, '未设置'),
          COALESCE(chant, '未设置'), COALESCE(last_path_change, 0),
          ${lastXpExpression}
        FROM users_legacy
      `);
      connection.exec('DROP TABLE users_legacy');
    })();
  } else if (!columnNames.has('last_xp_at')) {
    connection.exec('ALTER TABLE users ADD COLUMN last_xp_at INTEGER NOT NULL DEFAULT 0');
  }

  connection.pragma('user_version = 2');
}

function createDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const connection = new Database(filename);
  connection.pragma('journal_mode = WAL');
  migrateSchema(connection);

  const selectUser = connection.prepare(`
    SELECT * FROM users WHERE guild_id = ? AND user_id = ?
  `);
  const insertUser = connection.prepare(`
    INSERT OR IGNORE INTO users (guild_id, user_id) VALUES (?, ?)
  `);
  const updateProfileStatement = connection.prepare(`
    UPDATE users
    SET ability_name = ?, chant = ?
    WHERE guild_id = ? AND user_id = ?
  `);
  const updatePathStatement = connection.prepare(`
    UPDATE users
    SET path = ?, last_path_change = ?
    WHERE guild_id = ? AND user_id = ?
  `);
  const updateProgressStatement = connection.prepare(`
    UPDATE users
    SET level = ?, xp = ?, xp_needed = ?, total_xp = ?, last_xp_at = ?
    WHERE guild_id = ? AND user_id = ?
  `);
  const countHigherTotalXp = connection.prepare(`
    SELECT COUNT(*) AS higher
    FROM users
    WHERE guild_id = ? AND total_xp > ?
  `);
  const selectLeaderboard = connection.prepare(`
    SELECT
      user_id, path, level, xp, xp_needed, total_xp,
      RANK() OVER (ORDER BY total_xp DESC) AS rank
    FROM users
    WHERE guild_id = ?
    ORDER BY total_xp DESC, user_id ASC
    LIMIT ?
  `);
  const selectLeaderboardByPath = connection.prepare(`
    SELECT
      user_id, path, level, xp, xp_needed, total_xp,
      RANK() OVER (ORDER BY total_xp DESC) AS rank
    FROM users
    WHERE guild_id = ? AND path = ?
    ORDER BY total_xp DESC, user_id ASC
    LIMIT ?
  `);

  function getUser(guildId, userId) {
    return selectUser.get(guildId, userId);
  }

  function getOrCreateUser(guildId, userId) {
    insertUser.run(guildId, userId);
    return getUser(guildId, userId);
  }

  function updateProfile(guildId, userId, { abilityName, chant }) {
    getOrCreateUser(guildId, userId);
    updateProfileStatement.run(abilityName, chant, guildId, userId);
    return getUser(guildId, userId);
  }

  function changePath(guildId, userId, newPath, now = Date.now()) {
    const user = getOrCreateUser(guildId, userId);
    if (user.path === newPath) {
      return { changed: false, reason: 'same', user };
    }

    const elapsed = now - user.last_path_change;
    if (user.last_path_change > 0 && elapsed < PATH_COOLDOWN_MS) {
      return {
        changed: false,
        reason: 'cooldown',
        remainingMs: PATH_COOLDOWN_MS - elapsed,
        user
      };
    }

    updatePathStatement.run(newPath, now, guildId, userId);
    return { changed: true, user: getUser(guildId, userId) };
  }

  const awardMessageXpTransaction = connection.transaction((guildId, userId, gain, now, cooldownMs) => {
    const user = getOrCreateUser(guildId, userId);
    const elapsed = now - user.last_xp_at;
    if (user.last_xp_at > 0 && elapsed < cooldownMs) {
      return {
        awarded: false,
        retryAfterMs: cooldownMs - elapsed,
        levelsGained: 0,
        user
      };
    }

    const progress = applyXp(
      { level: user.level, xp: user.xp, xpNeeded: user.xp_needed },
      gain
    );
    updateProgressStatement.run(
      progress.level,
      progress.xp,
      progress.xpNeeded,
      user.total_xp + gain,
      now,
      guildId,
      userId
    );

    return {
      awarded: true,
      levelsGained: progress.levelsGained,
      user: getUser(guildId, userId)
    };
  });

  function awardMessageXp(
    guildId,
    userId,
    gain,
    now = Date.now(),
    cooldownMs = MESSAGE_XP_COOLDOWN_MS
  ) {
    return awardMessageXpTransaction(guildId, userId, gain, now, cooldownMs);
  }

  function getRank(guildId, userId) {
    const user = getUser(guildId, userId);
    if (!user) return null;
    return countHigherTotalXp.get(guildId, user.total_xp).higher + 1;
  }

  function getLeaderboard(guildId, { path: profilePath = null, limit = 10 } = {}) {
    if (profilePath !== null && !['esper', 'magician'].includes(profilePath)) {
      throw new RangeError('排行榜路线无效');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new RangeError('排行榜数量必须是 1 到 25 的整数');
    }

    return profilePath === null
      ? selectLeaderboard.all(guildId, limit)
      : selectLeaderboardByPath.all(guildId, profilePath, limit);
  }

  return {
    getUser,
    getOrCreateUser,
    updateProfile,
    changePath,
    awardMessageXp,
    getRank,
    getLeaderboard,
    close() {
      connection.close();
    }
  };
}

module.exports = {
  createDatabase,
  MESSAGE_XP_COOLDOWN_MS,
  PATH_COOLDOWN_MS,
  LEGACY_GUILD_ID
};

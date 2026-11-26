'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createDatabase, PATH_COOLDOWN_MS } = require('../database');

function temporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-bot-'));
  const filename = path.join(directory, 'profile.db');
  let database = createDatabase(filename);

  t.after(() => {
    if (database) database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return {
    filename,
    get database() {
      return database;
    },
    reopen() {
      database.close();
      database = createDatabase(filename);
      return database;
    }
  };
}

test('getOrCreateUser creates a complete default profile once', t => {
  const { database } = temporaryDatabase(t);

  const created = database.getOrCreateUser('guild-1', 'user-1');
  const fetched = database.getOrCreateUser('guild-1', 'user-1');

  assert.deepEqual(created, {
    guild_id: 'guild-1',
    user_id: 'user-1',
    path: 'esper',
    level: 1,
    xp: 0,
    xp_needed: 100,
    total_xp: 0,
    ability_name: '未设置',
    chant: '未设置',
    last_path_change: 0,
    last_xp_at: 0
  });
  assert.deepEqual(fetched, created);
});

test('updateProfile creates the user and persists both profile fields', t => {
  const { database } = temporaryDatabase(t);

  const updated = database.updateProfile('guild-1', 'user-1', {
    abilityName: '电击使',
    chant: '落雷'
  });

  assert.equal(updated.ability_name, '电击使');
  assert.equal(updated.chant, '落雷');
  assert.deepEqual(database.getUser('guild-1', 'user-1'), updated);
});

test('awardMessageXp enforces the cooldown before and at its boundary', t => {
  const { database } = temporaryDatabase(t);

  const first = database.awardMessageXp('guild-1', 'user-1', 10, 1_000);
  const beforeBoundary = database.awardMessageXp('guild-1', 'user-1', 15, 60_999);
  const atBoundary = database.awardMessageXp('guild-1', 'user-1', 15, 61_000);

  assert.equal(first.awarded, true);
  assert.equal(first.user.total_xp, 10);
  assert.deepEqual(beforeBoundary, {
    awarded: false,
    retryAfterMs: 1,
    levelsGained: 0,
    user: first.user
  });
  assert.equal(atBoundary.awarded, true);
  assert.equal(atBoundary.user.total_xp, 25);
  assert.equal(atBoundary.user.last_xp_at, 61_000);
});

test('message cooldown survives closing and reopening the database', t => {
  const holder = temporaryDatabase(t);
  holder.database.awardMessageXp('guild-1', 'user-1', 10, 5_000);

  const reopened = holder.reopen();
  const result = reopened.awardMessageXp('guild-1', 'user-1', 10, 64_999);

  assert.equal(result.awarded, false);
  assert.equal(result.retryAfterMs, 1);
  assert.equal(result.user.total_xp, 10);
});

test('member welcome ledger persists one delivery for each guild, user, and join timestamp', t => {
  const holder = temporaryDatabase(t);
  const joinedAt = 1_700_000_000_000;

  assert.equal(holder.database.hasMemberWelcome('guild-1', 'user-1', joinedAt), false);
  holder.database.recordMemberWelcome('guild-1', 'user-1', joinedAt, 'message-1', joinedAt + 1_000);

  assert.equal(holder.database.hasMemberWelcome('guild-1', 'user-1', joinedAt), true);
  assert.equal(holder.database.hasMemberWelcome('guild-1', 'user-1', joinedAt + 1), false);
  assert.equal(holder.database.hasMemberWelcome('guild-2', 'user-1', joinedAt), false);
  assert.equal(holder.database.hasMemberWelcome('guild-1', 'user-2', joinedAt), false);

  const reopened = holder.reopen();
  assert.equal(reopened.hasMemberWelcome('guild-1', 'user-1', joinedAt), true);
});

test('awardMessageXp can level multiple times in one transaction', t => {
  const { database } = temporaryDatabase(t);

  const result = database.awardMessageXp('guild-1', 'user-1', 400, 1_000);

  assert.equal(result.awarded, true);
  assert.equal(result.levelsGained, 2);
  assert.equal(result.user.level, 3);
  assert.equal(result.user.xp, 18);
  assert.equal(result.user.xp_needed, 519);
  assert.equal(result.user.total_xp, 400);
});

test('getRank gives tied users the same competition rank', t => {
  const { database } = temporaryDatabase(t);
  database.awardMessageXp('guild-1', 'alpha', 50, 1_000);
  database.awardMessageXp('guild-1', 'bravo', 50, 1_000);
  database.awardMessageXp('guild-1', 'charlie', 10, 1_000);

  assert.equal(database.getRank('guild-1', 'alpha'), 1);
  assert.equal(database.getRank('guild-1', 'bravo'), 1);
  assert.equal(database.getRank('guild-1', 'charlie'), 3);
  assert.equal(database.getRank('guild-1', 'missing'), null);
});

test('getLeaderboard ranks one guild deterministically and filters by route', t => {
  const { database } = temporaryDatabase(t);
  database.awardMessageXp('guild-1', 'science-low', 100, 1_000);
  database.awardMessageXp('guild-1', 'science-top', 300, 1_000);
  database.changePath('guild-1', 'magic-top', 'magician', 1_000);
  database.awardMessageXp('guild-1', 'magic-top', 300, 1_000);
  database.awardMessageXp('guild-2', 'outsider', 999, 1_000);

  const overall = database.getLeaderboard('guild-1', { limit: 10 });
  const science = database.getLeaderboard('guild-1', { path: 'esper', limit: 10 });
  const magic = database.getLeaderboard('guild-1', { path: 'magician', limit: 10 });

  assert.deepEqual(
    overall.map(({ user_id, path, total_xp, rank }) => ({
      user_id,
      path,
      total_xp,
      rank
    })),
    [
      { user_id: 'magic-top', path: 'magician', total_xp: 300, rank: 1 },
      { user_id: 'science-top', path: 'esper', total_xp: 300, rank: 1 },
      { user_id: 'science-low', path: 'esper', total_xp: 100, rank: 3 }
    ]
  );
  assert.deepEqual(science.map(row => [row.user_id, row.rank]), [
    ['science-top', 1],
    ['science-low', 2]
  ]);
  assert.deepEqual(magic.map(row => [row.user_id, row.rank]), [
    ['magic-top', 1]
  ]);
  assert.deepEqual(
    database.getLeaderboard('guild-1', { limit: 2 }).map(row => row.user_id),
    ['magic-top', 'science-top']
  );
});

test('getLeaderboard rejects unsupported paths and unsafe limits', t => {
  const { database } = temporaryDatabase(t);

  assert.throws(
    () => database.getLeaderboard('guild-1', { path: 'unknown' }),
    /排行榜路线无效/
  );
  assert.throws(
    () => database.getLeaderboard('guild-1', { limit: 0 }),
    /排行榜数量必须是 1 到 25 的整数/
  );
  assert.throws(
    () => database.getLeaderboard('guild-1', { limit: 26 }),
    /排行榜数量必须是 1 到 25 的整数/
  );
});

test('choosing the current path does not consume the path cooldown', t => {
  const { database } = temporaryDatabase(t);

  const same = database.changePath('guild-1', 'user-1', 'esper', 10_000);
  const changed = database.changePath('guild-1', 'user-1', 'magician', 10_000);

  assert.equal(same.changed, false);
  assert.equal(same.reason, 'same');
  assert.equal(same.user.last_path_change, 0);
  assert.equal(changed.changed, true);
  assert.equal(changed.user.path, 'magician');
  assert.equal(changed.user.last_path_change, 10_000);
});

test('path changes are blocked for seven days and allowed at the boundary', t => {
  const { database } = temporaryDatabase(t);
  database.changePath('guild-1', 'user-1', 'magician', 10_000);

  const blocked = database.changePath('guild-1', 'user-1', 'esper', 10_000 + PATH_COOLDOWN_MS - 1);
  const changed = database.changePath('guild-1', 'user-1', 'esper', 10_000 + PATH_COOLDOWN_MS);

  assert.equal(blocked.changed, false);
  assert.equal(blocked.reason, 'cooldown');
  assert.equal(blocked.remainingMs, 1);
  assert.equal(changed.changed, true);
  assert.equal(changed.user.path, 'esper');
});

test('createDatabase migrates a legacy users table with last_xp_at', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-legacy-'));
  const filename = path.join(directory, 'legacy.db');
  const legacy = new Database(filename);
  legacy.exec(`
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      path TEXT DEFAULT 'esper',
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      xp_needed INTEGER DEFAULT 100,
      total_xp INTEGER DEFAULT 0,
      ability_name TEXT DEFAULT '未设置',
      chant TEXT DEFAULT '未设置',
      last_path_change INTEGER DEFAULT 0
    )
  `);
  legacy.prepare('INSERT INTO users (user_id) VALUES (?)').run('legacy-user');
  legacy.close();

  const database = createDatabase(filename);
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  assert.equal(database.getUser('__legacy_global__', 'legacy-user').last_xp_at, 0);
  assert.equal(database.getUser('guild-1', 'legacy-user'), undefined);
});

test('profiles, cooldowns, and rankings are isolated per guild', t => {
  const { database } = temporaryDatabase(t);
  database.awardMessageXp('guild-a', 'shared-user', 50, 1_000);
  database.awardMessageXp('guild-a', 'leader', 100, 1_000);
  database.updateProfile('guild-a', 'shared-user', {
    abilityName: '科学侧档案',
    chant: '演算'
  });

  const guildBUser = database.getOrCreateUser('guild-b', 'shared-user');

  assert.equal(guildBUser.total_xp, 0);
  assert.equal(guildBUser.ability_name, '未设置');
  assert.equal(guildBUser.last_xp_at, 0);
  assert.equal(database.getRank('guild-a', 'shared-user'), 2);
  assert.equal(database.getRank('guild-b', 'shared-user'), 1);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDatabase } = require('../database');
const { handlePathSelection } = require('../path-selection');

function createTemporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-path-selection-'));
  const database = createDatabase(path.join(directory, 'profile.db'));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

function createInteraction() {
  const replies = [];
  return {
    guildId: 'guild-1',
    user: { id: 'member-1' },
    member: { id: 'member-1' },
    async reply(payload) {
      replies.push(payload);
    },
    replies
  };
}

test('button path selection saves the route, synchronizes roles, and replies privately', async t => {
  const database = createTemporaryDatabase(t);
  const interaction = createInteraction();
  const identityCalls = [];
  const growthCalls = [];

  await handlePathSelection(interaction, 'magician', {
    database,
    async syncRouteRole(input) {
      identityCalls.push(input);
      return { status: 'synced' };
    },
    async syncGrowthRole(input) {
      growthCalls.push(input);
      return { status: 'synced' };
    }
  }, { successEphemeral: true });

  assert.equal(database.getUser('guild-1', 'member-1').path, 'magician');
  assert.deepEqual(identityCalls, [{
    member: interaction.member,
    guildId: 'guild-1',
    path: 'magician'
  }]);
  assert.deepEqual(growthCalls, [{
    member: interaction.member,
    guildId: 'guild-1',
    path: 'magician',
    level: 1
  }]);
  assert.deepEqual(interaction.replies, [{
    content: '已切换为 **魔法侧魔法师** 路线。',
    ephemeral: true
  }]);
});

test('button path selection keeps cooldown replies private without syncing roles', async t => {
  const database = createTemporaryDatabase(t);
  database.changePath('guild-1', 'member-1', 'magician', Date.now());
  const interaction = createInteraction();
  let syncCalls = 0;

  await handlePathSelection(interaction, 'esper', {
    database,
    async syncRouteRole() {
      syncCalls += 1;
      return { status: 'synced' };
    }
  }, { successEphemeral: true });

  assert.equal(database.getUser('guild-1', 'member-1').path, 'magician');
  assert.equal(syncCalls, 0);
  assert.equal(interaction.replies[0].ephemeral, true);
  assert.match(interaction.replies[0].content, /冷却中，还需 \*\*7\*\* 天才能切换。/);
});

test('selecting the current route resynchronizes both profile roles', async t => {
  const database = createTemporaryDatabase(t);
  const interaction = createInteraction();
  const calls = [];

  await handlePathSelection(interaction, 'esper', {
    database,
    async syncRouteRole(input) {
      calls.push(['identity', input.path]);
      return { status: 'already_synced' };
    },
    async syncGrowthRole(input) {
      calls.push(['growth', input.path, input.level]);
      return { status: 'already_synced' };
    }
  }, { successEphemeral: true });

  assert.deepEqual(calls, [
    ['identity', 'esper'],
    ['growth', 'esper', 1]
  ]);
  assert.deepEqual(interaction.replies, [{
    content: '你已经是科学侧能力者了。',
    ephemeral: true
  }]);
});

test('a role sync failure preserves the selected route and gives a private retry reply', async t => {
  const database = createTemporaryDatabase(t);
  const interaction = createInteraction();

  await handlePathSelection(interaction, 'magician', {
    database,
    async syncRouteRole() {
      return { status: 'failed', reason: 'missing permission' };
    }
  }, { successEphemeral: true });

  assert.equal(database.getUser('guild-1', 'member-1').path, 'magician');
  assert.deepEqual(interaction.replies, [{
    content: '档案已保存，但身份或成长角色同步失败，请稍后再次选择当前路线重试。',
    ephemeral: true
  }]);
});

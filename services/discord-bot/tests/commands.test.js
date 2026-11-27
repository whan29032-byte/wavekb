'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDatabase } = require('../database');
const { loadCommands } = require('../command-loader');
const leaderboardCommand = require('../commands/leaderboard');
const profileCommand = require('../commands/profile');
const setProfileCommand = require('../commands/set-profile');
const selectPathCommand = require('../commands/select-path');

function createTemporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-command-'));
  const database = createDatabase(path.join(directory, 'profile.db'));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

function createInteraction({
  userId = 'author',
  guildId = 'guild-1',
  strings = {},
  targetUser = null,
  member = null,
  client = { users: { async fetch(id) { return { id, username: id }; } } }
} = {}) {
  const replies = [];
  const edits = [];
  let deferred = false;

  return {
    guildId,
    user: { id: userId, username: userId },
    member,
    client,
    options: {
      getString(name) {
        return strings[name] ?? null;
      },
      getUser(name) {
        return name === '用户' ? targetUser : null;
      }
    },
    async deferReply() {
      deferred = true;
    },
    async reply(payload) {
      replies.push(payload);
    },
    async editReply(payload) {
      edits.push(payload);
    },
    get replies() {
      return replies;
    },
    get edits() {
      return edits;
    },
    get deferred() {
      return deferred;
    }
  };
}

test('slash command JSON exposes the original profile commands and option limits', () => {
  const leaderboard = leaderboardCommand.data.toJSON();
  const profile = profileCommand.data.toJSON();
  const setProfile = setProfileCommand.data.toJSON();
  const selectPath = selectPathCommand.data.toJSON();

  assert.equal(profile.name, '档案');
  assert.deepEqual(
    profile.options.map(option => ({ name: option.name, required: option.required })),
    [{ name: '用户', required: false }]
  );

  assert.equal(setProfile.name, '设置档案');
  assert.deepEqual(
    setProfile.options.map(option => ({
      name: option.name,
      required: option.required,
      maxLength: option.max_length
    })),
    [
      { name: '名称', required: true, maxLength: 20 },
      { name: '咏唱', required: true, maxLength: 40 }
    ]
  );

  assert.equal(selectPath.name, '选择路线');
  assert.deepEqual(
    selectPath.options[0].choices.map(choice => choice.value),
    ['esper', 'magician']
  );

  assert.equal(leaderboard.name, '排行榜');
  assert.deepEqual(
    leaderboard.options.map(option => ({
      name: option.name,
      required: option.required,
      choices: option.choices.map(choice => choice.value)
    })),
    [{ name: '范围', required: false, choices: ['all', 'esper', 'magician'] }]
  );
});

test('setting a profile creates the user and replies privately', async t => {
  const database = createTemporaryDatabase(t);
  const interaction = createInteraction({
    strings: { 名称: '幻想杀手', 咏唱: '破除一切幻想' }
  });

  await setProfileCommand.execute(interaction, { database });

  const saved = database.getUser('guild-1', 'author');
  assert.equal(saved.ability_name, '幻想杀手');
  assert.equal(saved.chant, '破除一切幻想');
  assert.deepEqual(interaction.replies, [{
    content: '设置成功！\n能力名称：**幻想杀手**\n发动词：**破除一切幻想**',
    ephemeral: true
  }]);
});

test('selecting the current path gives a private explanation without consuming cooldown', async t => {
  const database = createTemporaryDatabase(t);
  const member = { id: 'member' };
  const interaction = createInteraction({ strings: { 路线: 'esper' }, member });
  const identityCalls = [];
  const growthCalls = [];

  await selectPathCommand.execute(interaction, {
    database,
    async syncRouteRole(input) {
      identityCalls.push(input);
      return { status: 'already_synced', added: false, removed: false };
    },
    async syncGrowthRole(input) {
      growthCalls.push(input);
      return { status: 'already_synced', added: false, removedRoleIds: [] };
    }
  });

  assert.equal(database.getUser('guild-1', 'author').last_path_change, 0);
  assert.deepEqual(identityCalls, [{ member, guildId: 'guild-1', path: 'esper' }]);
  assert.deepEqual(growthCalls, [{ member, guildId: 'guild-1', path: 'esper', level: 1 }]);
  assert.deepEqual(interaction.replies, [{
    content: '你已经是科学侧能力者了。',
    ephemeral: true
  }]);
});

test('selecting a path during cooldown reports the remaining days', async t => {
  const database = createTemporaryDatabase(t);
  database.changePath('guild-1', 'author', 'magician', Date.now());
  const interaction = createInteraction({ strings: { 路线: 'esper' } });

  let syncCalls = 0;
  await selectPathCommand.execute(interaction, {
    database,
    async syncRouteRole() {
      syncCalls += 1;
      return { status: 'synced' };
    }
  });

  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.replies[0].ephemeral, true);
  assert.match(interaction.replies[0].content, /冷却中，还需 \*\*7\*\* 天才能切换。/);
  assert.equal(database.getUser('guild-1', 'author').path, 'magician');
  assert.equal(syncCalls, 0);
});

test('switching paths saves first and synchronizes the selected identity role', async t => {
  const database = createTemporaryDatabase(t);
  const member = { id: 'member' };
  const interaction = createInteraction({ strings: { 路线: 'magician' }, member });
  const identityCalls = [];
  const growthCalls = [];

  await selectPathCommand.execute(interaction, {
    database,
    async syncRouteRole(input) {
      identityCalls.push({ ...input, savedPath: database.getUser('guild-1', 'author').path });
      return { status: 'synced', added: true, removed: false };
    },
    async syncGrowthRole(input) {
      growthCalls.push({ ...input, savedPath: database.getUser('guild-1', 'author').path });
      return { status: 'synced', added: true, removedRoleIds: [] };
    }
  });

  assert.deepEqual(identityCalls, [{
    member,
    guildId: 'guild-1',
    path: 'magician',
    savedPath: 'magician'
  }]);
  assert.deepEqual(growthCalls, [{
    member,
    guildId: 'guild-1',
    path: 'magician',
    level: 1,
    savedPath: 'magician'
  }]);
  assert.deepEqual(interaction.replies, ['已切换为 **魔法侧魔法师** 路线。']);
});

test('a role sync failure preserves the saved path and provides a retryable reply', async t => {
  const database = createTemporaryDatabase(t);
  const interaction = createInteraction({ strings: { 路线: 'magician' } });

  await selectPathCommand.execute(interaction, {
    database,
    async syncRouteRole() {
      return { status: 'failed', reason: 'add_failed' };
    }
  });

  assert.equal(database.getUser('guild-1', 'author').path, 'magician');
  assert.deepEqual(interaction.replies, [{
    content: '档案已保存，但身份或成长角色同步失败，请稍后再次选择当前路线重试。',
    ephemeral: true
  }]);
});

test('a skipped role sync keeps the existing route reply semantics', async t => {
  const database = createTemporaryDatabase(t);
  const interaction = createInteraction({ strings: { 路线: 'magician' } });

  await selectPathCommand.execute(interaction, {
    database,
    async syncRouteRole() {
      return { status: 'skipped' };
    }
  });

  assert.deepEqual(interaction.replies, ['已切换为 **魔法侧魔法师** 路线。']);
});

test('profile command explains when the selected user has no profile', async t => {
  const database = createTemporaryDatabase(t);
  const targetUser = { id: 'missing', username: 'missing' };
  const interaction = createInteraction({ targetUser });

  await profileCommand.execute(interaction, {
    database,
    drawCard: async () => Buffer.from('unused')
  });

  assert.equal(interaction.deferred, true);
  assert.deepEqual(interaction.edits, [
    '该用户还没有档案，在服务器发送消息后即可自动创建。'
  ]);
});

test('profile command returns a named PNG attachment for an existing user', async t => {
  const database = createTemporaryDatabase(t);
  database.getOrCreateUser('guild-1', 'target');
  const targetUser = { id: 'target', username: 'target' };
  const interaction = createInteraction({ targetUser });

  await profileCommand.execute(interaction, {
    database,
    drawCard: async user => {
      assert.equal(user.rank, 1);
      return Buffer.from('png-data');
    }
  });

  assert.equal(interaction.edits.length, 1);
  assert.equal(interaction.edits[0].files.length, 1);
  assert.equal(interaction.edits[0].files[0].name, 'profile.png');
});

test('leaderboard command defaults to the total board and returns a named PNG', async t => {
  const database = createTemporaryDatabase(t);
  database.awardMessageXp('guild-1', 'science-user', 200, 1_000);
  database.changePath('guild-1', 'magic-user', 'magician', 1_000);
  database.awardMessageXp('guild-1', 'magic-user', 300, 1_000);
  const fetchedIds = [];
  const drawCalls = [];
  const interaction = createInteraction({
    client: {
      users: {
        async fetch(id) {
          fetchedIds.push(id);
          return {
            id,
            username: `用户-${id}`,
            displayAvatarURL: () => `https://cdn.discordapp.com/${id}.png`
          };
        }
      }
    }
  });

  await leaderboardCommand.execute(interaction, {
    database,
    async drawLeaderboard(entries, scope) {
      drawCalls.push({ entries, scope });
      return Buffer.from('leaderboard-png');
    }
  });

  assert.equal(interaction.deferred, true);
  assert.deepEqual(fetchedIds, ['magic-user', 'science-user']);
  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0].scope, 'all');
  assert.deepEqual(drawCalls[0].entries.map(entry => entry.user_id), [
    'magic-user',
    'science-user'
  ]);
  assert.equal(interaction.edits.length, 1);
  assert.equal(interaction.edits[0].files[0].name, 'leaderboard.png');
  assert.deepEqual(
    interaction.edits[0].files[0].attachment,
    Buffer.from('leaderboard-png')
  );
});

test('leaderboard command filters a route and keeps unavailable users as placeholders', async t => {
  const database = createTemporaryDatabase(t);
  database.awardMessageXp('guild-1', 'science-user', 500, 1_000);
  database.changePath('guild-1', 'magic-user', 'magician', 1_000);
  database.awardMessageXp('guild-1', 'magic-user', 100, 1_000);
  const interaction = createInteraction({
    strings: { 范围: 'magician' },
    client: {
      users: {
        async fetch() { throw new Error('unknown user'); }
      }
    }
  });
  let drawnEntries;

  await leaderboardCommand.execute(interaction, {
    database,
    async drawLeaderboard(entries, scope) {
      assert.equal(scope, 'magician');
      drawnEntries = entries;
      return Buffer.from('magic-board');
    }
  });

  assert.equal(drawnEntries.length, 1);
  assert.equal(drawnEntries[0].user_id, 'magic-user');
  assert.match(drawnEntries[0].discordUser.username, /^未知用户/);
  assert.throws(() => drawnEntries[0].discordUser.displayAvatarURL(), /用户头像不可用/);
  assert.equal(interaction.edits[0].files[0].name, 'leaderboard.png');
});

test('leaderboard command explains when the selected board is empty', async t => {
  const database = createTemporaryDatabase(t);
  const interaction = createInteraction({ strings: { 范围: 'magician' } });

  await leaderboardCommand.execute(interaction, {
    database,
    async drawLeaderboard() { throw new Error('must not render an empty board'); }
  });

  assert.deepEqual(interaction.edits, ['当前范围还没有排行榜数据。']);
});

test('loadCommands loads the command directory and rejects duplicate names', t => {
  const loaded = loadCommands(path.resolve(__dirname, '../commands'));
  assert.equal(loaded.collection.size, 14);
  assert.deepEqual(
    loaded.json.map(command => command.name).sort(),
    [
      '排行榜', '档案', '设置档案', '选择路线', '绑定网站', '网站账号',
      '玩法帮助', '签到', '打工', '技能抽奖', '技能图鉴', '行情', '押注', '宠物'
    ].sort()
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-duplicate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const moduleText = `module.exports = {
    data: { name: 'duplicate', toJSON() { return { name: 'duplicate' }; } },
    execute() {}
  };`;
  fs.writeFileSync(path.join(directory, 'a.js'), moduleText);
  fs.writeFileSync(path.join(directory, 'b.js'), moduleText);

  assert.throws(
    () => loadCommands(directory),
    { message: '命令名称重复：duplicate' }
  );
});

test('loadCommands rejects a module without an execute function', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(directory, 'invalid.js'),
    `module.exports = { data: { name: 'invalid', toJSON() { return { name: 'invalid' }; } } };`
  );

  assert.throws(
    () => loadCommands(directory),
    { message: '无效命令模块：invalid.js' }
  );
});

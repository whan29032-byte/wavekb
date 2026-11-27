'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeGameAction, gameErrorMessage, currentGamePath, sendGameReply } = require('../game-actions');

function interaction(overrides = {}) {
  const deferred = [];
  const edits = [];
  const followUps = [];
  let deleted = 0;
  return {
    id: '222222222222222222',
    guildId: '1545731927733047306',
    user: { id: '111111111111111111' },
    async deferReply(value) { deferred.push(value); },
    async editReply(value) { edits.push(value); },
    async followUp(value) { followUps.push(value); },
    async deleteReply() { deleted += 1; },
    deferred,
    edits,
    followUps,
    get deleted() { return deleted; },
    ...overrides
  };
}

test('executeGameAction defers once and forwards the Discord interaction ID unchanged', async () => {
  const calls = [];
  const value = interaction();
  const result = await executeGameAction(value, {
    websiteGuildId: value.guildId,
    websiteClient: {
      async gameAction(input) {
        calls.push(input);
        return { action: 'daily_checkin', points: 8 };
      }
    }
  }, 'daily_checkin');
  assert.deepEqual(value.deferred, [{ ephemeral: true }]);
  assert.deepEqual(calls, [{
    discordUserId: value.user.id,
    guildId: value.guildId,
    requestId: value.id,
    action: 'daily_checkin',
    payload: {}
  }]);
  assert.deepEqual(result, { action: 'daily_checkin', points: 8 });
});

test('public game success is published only after the private deferred request succeeds', async () => {
  const value = interaction();
  await value.deferReply({ ephemeral: true });
  await sendGameReply(value, { content: '签到成功' }, { public: true });
  assert.deepEqual(value.followUps, [{ content: '签到成功', ephemeral: false }]);
  assert.equal(value.deleted, 1);
});

test('embed permission preflight keeps the failure private instead of losing the command result', async () => {
  const value = interaction({ appPermissions: { has: () => false } });
  await value.deferReply({ ephemeral: true });
  await sendGameReply(value, { embeds: [{ title: '签到成功' }] }, { public: true });
  assert.match(value.edits[0].content, /Embed Links/);
  assert.match(value.edits[0].content, /请勿重复操作/);
  assert.equal(value.followUps.length, 0);
  assert.equal(value.deleted, 0);
});

test('executeGameAction blocks other guilds before the website call', async () => {
  let calls = 0;
  const value = interaction({ guildId: '999999999999999999' });
  const result = await executeGameAction(value, {
    websiteGuildId: '1545731927733047306',
    websiteClient: { async gameAction() { calls += 1; } }
  }, 'status');
  assert.equal(result, null);
  assert.equal(calls, 0);
  assert.deepEqual(value.edits, [{ content: '此命令只能在已配置的 Discord 服务器中使用。' }]);
});

test('executeGameAction checks Embed Links before any website mutation', async () => {
  let calls = 0;
  const value = interaction({ appPermissions: { has: () => false } });
  const result = await executeGameAction(value, {
    websiteGuildId: value.guildId,
    websiteClient: { async gameAction() { calls += 1; } }
  }, 'market_bet', { symbol: 'academy', direction: 'up', stake: 100 });
  assert.equal(result, null);
  assert.equal(calls, 0);
  assert.match(value.edits[0].content, /Embed Links/);
});

test('executeGameAction gives linked-account guidance and stable retry messages', async () => {
  for (const [code, pattern] of [
    ['not_linked', /绑定网站/],
    ['work_cooldown', /冷却/],
    ['website_timeout', /暂时无法连接/]
  ]) {
    const value = interaction();
    const result = await executeGameAction(value, {
      websiteGuildId: value.guildId,
      websiteClient: { async gameAction() { throw { code }; } }
    }, 'work', { path: 'esper' });
    assert.equal(result, null);
    assert.match(value.edits[0].content, pattern);
    assert.deepEqual(value.deferred, [{ ephemeral: true }]);
    assert.equal(value.followUps.length, 0);
  }
});

test('currentGamePath returns only the two supported local routes', () => {
  const value = interaction();
  assert.equal(currentGamePath(value, {
    database: { getOrCreateUser: () => ({ path: 'magician' }) }
  }), 'magician');
  assert.equal(currentGamePath(value, {
    database: { getOrCreateUser: () => ({ path: 'unexpected' }) }
  }), 'esper');
  assert.match(gameErrorMessage({ code: 'insufficient_points' }), /积分不足/);
  assert.match(gameErrorMessage({ code: 'website_timeout' }), /结果暂时无法确认/);
  assert.doesNotMatch(gameErrorMessage({ code: 'website_timeout' }), /没有重复执行/);
});

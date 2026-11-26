'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const help = require('../commands/game-help');
const daily = require('../commands/daily-checkin');
const work = require('../commands/work');
const skillDraw = require('../commands/skill-draw');
const skillCollection = require('../commands/skill-collection');

function interaction({ integer = null } = {}) {
  const deferred = [];
  const edits = [];
  const replies = [];
  const followUps = [];
  let deleted = 0;
  return {
    id: '222222222222222222',
    guildId: '1545731927733047306',
    user: { id: '111111111111111111' },
    options: { getInteger: () => integer },
    async deferReply(value) { deferred.push(value); },
    async editReply(value) { edits.push(value); },
    async reply(value) { replies.push(value); },
    async followUp(value) { followUps.push(value); },
    async deleteReply() { deleted += 1; },
    deferred,
    edits,
    replies,
    followUps,
    get deleted() { return deleted; }
  };
}

function context(result, path = 'esper') {
  const calls = [];
  return {
    calls,
    value: {
      websiteGuildId: '1545731927733047306',
      database: { getOrCreateUser: () => ({ path }) },
      websiteClient: {
        async gameAction(input) {
          calls.push(input);
          return typeof result === 'function' ? result(input) : result;
        }
      }
    }
  };
}

test('economy command schemas expose the five intended Chinese commands', () => {
  assert.deepEqual(
    [help, daily, work, skillDraw, skillCollection].map(command => command.data.toJSON().name),
    ['玩法帮助', '签到', '打工', '技能抽奖', '技能图鉴']
  );
  const drawJson = skillDraw.data.toJSON();
  assert.deepEqual(drawJson.options[0].choices.map(choice => choice.value), [1, 10]);
});

test('help explains every retained game loop and the virtual-points boundary', async () => {
  const value = interaction();
  await help.execute(value);
  assert.equal(value.replies[0].ephemeral, true);
  const text = JSON.stringify(value.replies[0]);
  for (const keyword of ['签到', '打工', '技能抽奖', '行情', '宠物', '不可提现']) {
    assert.match(text, new RegExp(keyword));
  }
});

test('daily check-in is public, shared with the website and distinguishes a repeated claim', async () => {
  for (const awarded of [true, false]) {
    const value = interaction();
    const state = context({ action: 'daily_checkin', awarded, points: 8, streak: 4, balance: 208 });
    await daily.execute(value, state.value);
    assert.deepEqual(value.deferred, [{ ephemeral: true }]);
    assert.equal(state.calls[0].action, 'daily_checkin');
    assert.match(JSON.stringify(value.followUps[0]), awarded ? /获得.*8/ : /已经签到/);
    assert.equal(value.followUps[0].ephemeral, false);
    assert.equal(value.deleted, 1);
    assert.doesNotMatch(JSON.stringify(value.followUps[0]), /积分余额|208/);
  }
});

test('work sends the local route and presents the reward and daily count', async () => {
  const value = interaction();
  const state = context({
    action: 'work', path: 'magician', job: '维护术式结界', points: 42,
    workCount: 2, balance: 350, nextAvailableAt: '2026-11-26T08:00:00.000Z'
  }, 'magician');
  await work.execute(value, state.value);
  assert.deepEqual(state.calls[0].payload, { path: 'magician' });
  assert.match(JSON.stringify(value.followUps[0]), /维护术式结界/);
  assert.match(JSON.stringify(value.followUps[0]), /42/);
  assert.match(JSON.stringify(value.followUps[0]), /2.*4/);
  assert.doesNotMatch(JSON.stringify(value.followUps[0]), /积分余额|350/);
});

test('ten skill draws use the selected route and show rarity, duplicates and pity', async () => {
  const value = interaction({ integer: 10 });
  const state = context({
    action: 'skill_draw', path: 'esper', cost: 900, balance: 100,
    draws: [
      { name: '空间移动', rarity: 'epic', isNew: true, compensation: 0 },
      { name: '念动力', rarity: 'common', isNew: false, compensation: 15 }
    ],
    pity: { epic: 1, legendary: 12 }
  });
  await skillDraw.execute(value, state.value);
  assert.deepEqual(state.calls[0].payload, { path: 'esper', count: 10 });
  const output = JSON.stringify(value.followUps[0]);
  assert.match(output, /空间移动/);
  assert.match(output, /重复.*15/);
  assert.match(output, /史诗保底.*1/);
  assert.doesNotMatch(output, /积分余额/);
});

test('skill collection is private and remains separated by the local route', async () => {
  const value = interaction();
  const state = context({
    action: 'skill_collection', path: 'magician', balance: 500,
    skills: [{ name: '炼金术', rarity: 'rare', quantity: 2 }],
    pity: { epic: 3, legendary: 8 }
  }, 'magician');
  await skillCollection.execute(value, state.value);
  assert.deepEqual(value.deferred, [{ ephemeral: true }]);
  assert.deepEqual(state.calls[0].payload, { path: 'magician' });
  assert.match(JSON.stringify(value.edits[0]), /魔法侧/);
  assert.match(JSON.stringify(value.edits[0]), /炼金术.*2/);
});

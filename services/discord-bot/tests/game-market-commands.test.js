'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const market = require('../commands/market');
const bet = require('../commands/bet');

function interaction({ strings = {}, integer = null } = {}) {
  const deferred = [];
  const edits = [];
  return {
    id: '222222222222222222', guildId: '1545731927733047306',
    user: { id: '111111111111111111' },
    options: {
      getString(name) { return strings[name] ?? null; },
      getInteger() { return integer; }
    },
    async deferReply(value) { deferred.push(value); },
    async editReply(value) { edits.push(value); },
    deferred, edits
  };
}

function context(result) {
  const calls = [];
  return {
    calls,
    value: {
      websiteGuildId: '1545731927733047306',
      websiteClient: { async gameAction(input) { calls.push(input); return result; } }
    }
  };
}

test('market schemas use the three fictional symbols, up/down and 10–500 limits', () => {
  assert.equal(market.data.toJSON().name, '行情');
  const json = bet.data.toJSON();
  assert.equal(json.name, '押注');
  assert.deepEqual(json.options[0].choices.map(choice => choice.value), ['academy', 'grimoire', 'petegg']);
  assert.deepEqual(json.options[1].choices.map(choice => choice.value), ['up', 'down']);
  assert.equal(json.options[2].min_value, 10);
  assert.equal(json.options[2].max_value, 500);
});

test('open market view hides future changes and reports the daily cap and deadlines', async () => {
  const value = interaction();
  const state = context({
    action: 'market_view', phase: 'open', date: '2026-11-26', dailyStake: 120, dailyLimit: 500,
    symbols: [
      { symbol: 'academy', name: '学园都市科技指数', changeBps: null, direction: null },
      { symbol: 'grimoire', name: '魔导书术式指数', changeBps: null, direction: null }
    ]
  });
  await market.execute(value, state.value);
  assert.deepEqual(value.deferred, [{ ephemeral: true }]);
  assert.equal(state.calls[0].action, 'market_view');
  const output = JSON.stringify(value.edits[0]);
  assert.match(output, /尚未公布/);
  assert.match(output, /120.*500/);
  assert.match(output, /21:00.*22:00/);
  assert.doesNotMatch(output, /changeBps|direction/);
});

test('settled market view shows signed percentage changes', async () => {
  const value = interaction();
  const state = context({
    action: 'market_view', phase: 'settled', date: '2026-11-26', dailyStake: 0, dailyLimit: 500,
    symbols: [
      { symbol: 'academy', name: '学园都市科技指数', changeBps: 235, direction: 'up' },
      { symbol: 'petegg', name: '幻想宠物蛋指数', changeBps: -810, direction: 'down' }
    ]
  });
  await market.execute(value, state.value);
  const output = JSON.stringify(value.edits[0]);
  assert.match(output, /\+2\.35%/);
  assert.match(output, /-8\.10%/);
});

test('bet sends the exact choice and returns a private virtual-points receipt', async () => {
  const value = interaction({
    strings: { 品种: 'grimoire', 方向: 'down' },
    integer: 125
  });
  const state = context({
    action: 'market_bet', date: '2026-11-26', symbol: 'grimoire',
    direction: 'down', stake: 125, dailyStake: 225, balance: 875
  });
  await bet.execute(value, state.value);
  assert.deepEqual(value.deferred, [{ ephemeral: true }]);
  assert.deepEqual(state.calls[0].payload, { symbol: 'grimoire', direction: 'down', stake: 125 });
  const output = JSON.stringify(value.edits[0]);
  assert.match(output, /魔导书术式指数/);
  assert.match(output, /下跌/);
  assert.match(output, /125/);
  assert.match(output, /虚拟积分.*不可提现/);
});

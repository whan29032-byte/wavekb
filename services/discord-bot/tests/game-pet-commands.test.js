'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pet = require('../commands/pet');

function interaction({ subcommand, strings = {}, integer = null, integers = {} } = {}) {
  const deferred = [];
  const edits = [];
  const followUps = [];
  let deleted = 0;
  return {
    id: '222222222222222222', guildId: '1545731927733047306',
    user: { id: '111111111111111111' },
    options: {
      getSubcommand() { return subcommand; },
      getString(name) { return strings[name] ?? null; },
      getInteger(name) { return integers[name] ?? integer; }
    },
    async deferReply(value) { deferred.push(value); },
    async editReply(value) { edits.push(value); },
    async followUp(value) { followUps.push(value); },
    async deleteReply() { deleted += 1; },
    deferred, edits, followUps,
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
      websiteClient: { async gameAction(input) { calls.push(input); return result; } }
    }
  };
}

test('pet schema exposes the complete shop, adoption, egg and management loop', () => {
  const json = pet.data.toJSON();
  assert.equal(json.name, '宠物');
  assert.deepEqual(json.options.map(option => option.name), [
    '商店', '领养', '购买', '孵化', '我的', '改名', '出战'
  ]);
  const purchase = json.options.find(option => option.name === '购买');
  assert.deepEqual(purchase.options[0].choices.map(choice => choice.value), ['basic', 'route', 'premium']);
  assert.equal(purchase.options[1].min_value, 1);
  assert.equal(purchase.options[1].max_value, 10);
  const list = json.options.find(option => option.name === '我的');
  assert.equal(list.options[0].name, '页码');
  assert.equal(list.options[0].min_value, 1);
});

test('shop displays all egg prices and the current balance privately', async () => {
  const value = interaction({ subcommand: '商店' });
  const state = context({
    action: 'pet_shop', balance: 900,
    eggs: [
      { type: 'basic', name: '普通宠物蛋', price: 150 },
      { type: 'route', name: '阵营宠物蛋', price: 350 },
      { type: 'premium', name: '幻想宠物蛋', price: 700 }
    ]
  });
  await pet.execute(value, state.value);
  assert.equal(state.calls[0].action, 'pet_shop');
  assert.deepEqual(value.deferred, [{ ephemeral: true }]);
  assert.match(JSON.stringify(value.edits[0]), /普通宠物蛋.*150.*阵营宠物蛋.*350.*幻想宠物蛋.*700/);
});

test('daily adoption uses the current route and publicly reveals the pet', async () => {
  const value = interaction({ subcommand: '领养' });
  const state = context({
    action: 'pet_adopt',
    pet: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '御坂猫', nickname: '御坂猫', rarity: 'rare', emoji: '🐈', route: 'esper', active: false }
  });
  await pet.execute(value, state.value);
  assert.deepEqual(state.calls[0].payload, { path: 'esper' });
  assert.deepEqual(value.deferred, [{ ephemeral: true }]);
  assert.match(JSON.stringify(value.followUps[0]), /御坂猫/);
  assert.equal(value.followUps[0].ephemeral, false);
  assert.doesNotMatch(JSON.stringify(value.followUps[0]), /aaaaaaaa-aaaa/);
});

test('route egg purchase and hatch preserve route and 1–10 quantity', async () => {
  const buyValue = interaction({ subcommand: '购买', strings: { 蛋: 'route' }, integer: 3 });
  const bought = context({ action: 'pet_buy_egg', eggType: 'route', quantity: 3, cost: 1050, balance: 50, eggs: 3 }, 'magician');
  await pet.execute(buyValue, bought.value);
  assert.deepEqual(bought.calls[0].payload, { eggType: 'route', quantity: 3, path: 'magician' });
  assert.match(JSON.stringify(buyValue.edits[0]), /3.*1,050/);

  const hatchValue = interaction({ subcommand: '孵化', strings: { 蛋: 'route' }, integer: 2 });
  const hatched = context({
    action: 'pet_hatch', eggType: 'route', eggsRemaining: 1,
    pets: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '符文史莱姆', nickname: '符文史莱姆', rarity: 'common', emoji: '🔮' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '魔导幼龙', nickname: '魔导幼龙', rarity: 'epic', emoji: '🐲' }
    ]
  }, 'magician');
  await pet.execute(hatchValue, hatched.value);
  assert.deepEqual(hatched.calls[0].payload, { eggType: 'route', quantity: 2, path: 'magician' });
  assert.deepEqual(hatchValue.deferred, [{ ephemeral: true }]);
  assert.match(JSON.stringify(hatchValue.followUps[0]), /符文史莱姆.*魔导幼龙/);
  assert.equal(hatchValue.followUps[0].ephemeral, false);
  assert.doesNotMatch(JSON.stringify(hatchValue.followUps[0]), /aaaaaaaa-aaaa|bbbbbbbb-bbbb/);
});

test('list pagination, rename and active-pet actions remain private and carry only pet IDs', async () => {
  const petId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const listValue = interaction({ subcommand: '我的', integers: { 页码: 2 } });
  const listed = context({
    action: 'pet_list', eggs: { basic: 2, route_esper: 1 },
    page: 2, totalPages: 3, total: 51,
    pets: [{ id: petId, name: '御坂猫', nickname: '电电', rarity: 'rare', emoji: '🐈', active: true }]
  });
  await pet.execute(listValue, listed.value);
  assert.deepEqual(listed.calls[0].payload, { page: 2 });
  assert.match(JSON.stringify(listValue.edits[0]), /电电.*出战中.*普通宠物蛋.*2/);
  assert.match(JSON.stringify(listValue.edits[0]), /第 2\/3 页.*51/);

  const renameValue = interaction({ subcommand: '改名', strings: { 宠物id: petId, 名称: '  小电  ' } });
  const renamed = context({ action: 'pet_rename', petId, name: '小电' });
  await pet.execute(renameValue, renamed.value);
  assert.deepEqual(renamed.calls[0].payload, { petId, name: '小电' });

  const activeValue = interaction({ subcommand: '出战', strings: { 宠物id: petId } });
  const activated = context({ action: 'pet_activate', petId, active: true });
  await pet.execute(activeValue, activated.value);
  assert.deepEqual(activated.calls[0].payload, { petId });
  assert.deepEqual(activeValue.deferred, [{ ephemeral: true }]);
});

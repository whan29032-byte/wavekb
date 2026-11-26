'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateTitle, getCardData } = require('../profile');

test('science-side titles change at levels 11, 26, and 41', () => {
  assert.equal(generateTitle('esper', 1), '低阶能力者');
  assert.equal(generateTitle('esper', 11), 'Level 3 中阶能力者');
  assert.equal(generateTitle('esper', 26), 'Level 4 高阶能力者');
  assert.equal(generateTitle('esper', 41), 'Level 5 超能力者');
});

test('magic-side titles change at levels 11, 26, and 41', () => {
  assert.equal(generateTitle('magician', 1), '魔法学徒');
  assert.equal(generateTitle('magician', 11), '正式魔法师');
  assert.equal(generateTitle('magician', 26), '高阶魔法师');
  assert.equal(generateTitle('magician', 41), '大魔法师');
});

test('science-side card data restores the calculation labels', () => {
  assert.deepEqual(getCardData({ path: 'esper', level: 41 }), {
    title: '学园都市·演算档案',
    rankLabel: '能力者排名',
    nameLabel: '能力名称',
    chantLabel: '发动词',
    advancedLabel: '完全控制',
    powerLabel: '演算力',
    totalLabel: '总演算量',
    titleText: 'Level 5 超能力者',
    advancedText: '已开启'
  });
});

test('magic-side card data restores the grimoire labels', () => {
  assert.deepEqual(getCardData({ path: 'magician', level: 10 }), {
    title: '魔法侧·术式档案',
    rankLabel: '术式排名',
    nameLabel: '术式名',
    chantLabel: '咏唱',
    advancedLabel: '原典接触',
    powerLabel: '魔力',
    totalLabel: '总魔力量',
    titleText: '魔法学徒',
    advancedText: '未开启（需 Lv.41）'
  });
});

test('unknown profile paths are rejected explicitly', () => {
  assert.throws(
    () => getCardData({ path: 'unknown', level: 1 }),
    { name: 'RangeError', message: '未知路线：unknown' }
  );
});

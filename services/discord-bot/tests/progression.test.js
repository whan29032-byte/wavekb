'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getXpNeeded, applyXp } = require('../progression');

test('level one requires exactly 100 experience', () => {
  assert.equal(getXpNeeded(1), 100);
});

test('zero gained experience preserves progress without leveling', () => {
  const state = { level: 3, xp: 42, xpNeeded: 519 };

  assert.deepEqual(applyXp(state, 0), {
    level: 3,
    xp: 42,
    xpNeeded: 519,
    levelsGained: 0
  });
  assert.deepEqual(state, { level: 3, xp: 42, xpNeeded: 519 });
});

test('experience equal to the requirement advances one level', () => {
  assert.deepEqual(
    applyXp({ level: 1, xp: 90, xpNeeded: 100 }, 10),
    { level: 2, xp: 0, xpNeeded: 282, levelsGained: 1 }
  );
});

test('a large gain can cross multiple levels and keeps the remainder', () => {
  assert.deepEqual(
    applyXp({ level: 1, xp: 0, xpNeeded: 100 }, 400),
    { level: 3, xp: 18, xpNeeded: 519, levelsGained: 2 }
  );
});

test('negative experience is rejected', () => {
  assert.throws(
    () => applyXp({ level: 1, xp: 0, xpNeeded: 100 }, -1),
    { name: 'RangeError', message: '经验值不能为负数' }
  );
});

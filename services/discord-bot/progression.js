'use strict';

function getXpNeeded(level) {
  return Math.floor(100 * level ** 1.5);
}

function applyXp(state, gain) {
  if (gain < 0) {
    throw new RangeError('经验值不能为负数');
  }

  let level = state.level;
  let xp = state.xp + gain;
  let xpNeeded = state.xpNeeded;
  let levelsGained = 0;

  while (xp >= xpNeeded) {
    xp -= xpNeeded;
    level += 1;
    xpNeeded = getXpNeeded(level);
    levelsGained += 1;
  }

  return { level, xp, xpNeeded, levelsGained };
}

module.exports = { getXpNeeded, applyXp };

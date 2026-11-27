'use strict';

const CARD_LABELS = {
  esper: {
    title: '学园都市·演算档案',
    rankLabel: '能力者排名',
    nameLabel: '能力名称',
    chantLabel: '发动词',
    advancedLabel: '完全控制',
    powerLabel: '演算力',
    totalLabel: '总演算量'
  },
  magician: {
    title: '魔法侧·术式档案',
    rankLabel: '术式排名',
    nameLabel: '术式名',
    chantLabel: '咏唱',
    advancedLabel: '原典接触',
    powerLabel: '魔力',
    totalLabel: '总魔力量'
  }
};

function assertKnownPath(profilePath) {
  if (!CARD_LABELS[profilePath]) {
    throw new RangeError(`未知路线：${profilePath}`);
  }
}

function generateTitle(profilePath, level) {
  assertKnownPath(profilePath);

  if (profilePath === 'esper') {
    if (level >= 41) return 'Level 5 超能力者';
    if (level >= 26) return 'Level 4 高阶能力者';
    if (level >= 11) return 'Level 3 中阶能力者';
    return '低阶能力者';
  }

  if (level >= 41) return '大魔法师';
  if (level >= 26) return '高阶魔法师';
  if (level >= 11) return '正式魔法师';
  return '魔法学徒';
}

function getCardData(user) {
  assertKnownPath(user.path);

  return {
    ...CARD_LABELS[user.path],
    titleText: generateTitle(user.path, user.level),
    advancedText: user.level >= 41 ? '已开启' : '未开启（需 Lv.41）'
  };
}

module.exports = { generateTitle, getCardData };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const snapshot = require('./fixtures/server-theme-snapshot.json');
const {
  TARGET_GUILD_ID,
  CHANNEL_CHANGES,
  GROWTH_ROLE_CHANGES,
  SCIENCE_GROWTH_ROLE_CHANGES,
  MAGIC_GROWTH_ROLE_DEFINITIONS,
  IDENTITY_ROLE_DEFINITIONS,
  buildWelcomePayload,
  validateThemeSnapshot,
  buildThemePlan
} = require('../server-theme');

function clone(value) {
  return structuredClone(value);
}

function makeAppliedSnapshot() {
  const applied = clone(snapshot);

  for (const change of CHANNEL_CHANGES) {
    const channel = applied.channels.find(({ id }) => id === change.id);
    channel.name = change.name;
    if (Object.hasOwn(change, 'topic')) channel.topic = change.topic;
  }

  for (const change of GROWTH_ROLE_CHANGES) {
    const role = applied.roles.find(({ id }) => id === change.id);
    role.name = change.name;
    role.color = change.color;
    role.icon = `theme-${change.iconKey}`;
  }

  for (const definition of IDENTITY_ROLE_DEFINITIONS) {
    applied.roles.push({
      id: `identity-${definition.key}`,
      name: definition.name,
      color: definition.color,
      position: 1,
      permissions: definition.permissions,
      managed: false,
      icon: null,
      unicodeEmoji: null
    });
  }

  for (const [index, definition] of MAGIC_GROWTH_ROLE_DEFINITIONS.entries()) {
    applied.roles.push({
      id: `magic-growth-${index}`,
      name: definition.name,
      color: definition.color,
      position: 1,
      permissions: definition.permissions,
      managed: false,
      icon: `theme-${definition.iconKey}`,
      unicodeEmoji: null
    });
  }

  return applied;
}

function roleIconHashes(themeSnapshot) {
  return Object.fromEntries(
    themeSnapshot.roles
      .filter(role => role.icon)
      .map(role => [role.id, role.icon])
  );
}

function magicGrowthRoleIds(themeSnapshot) {
  return MAGIC_GROWTH_ROLE_DEFINITIONS.map(({ name }) => (
    themeSnapshot.roles.find(role => role.name === name).id
  ));
}

test('theme manifest exposes distinct six-stage science and magic growth tracks', () => {
  assert.equal(TARGET_GUILD_ID, '1545731927733047306');
  assert.equal(CHANNEL_CHANGES.length, 15);
  assert.deepEqual(
    CHANNEL_CHANGES.map(({ id, expectedName, name }) => ({ id, expectedName, name })),
    [
      { id: '1545734710888632411', expectedName: '欢迎悠の茶话会', name: '📜・入学登记处' },
      { id: '1545731928861311056', expectedName: '悠の茶话会', name: '🌸・悠の茶话会' },
      { id: '1545731928861311058', expectedName: '悠の花园', name: '🌿・悠の花园' },
      { id: '1558681467268239482', expectedName: '学园都市', name: '🏙️・学园都市' },
      { id: '1545734021630132304', expectedName: '悠の小工具', name: '⚙️・演算终端' },
      { id: '1546525345358811246', expectedName: '股指外汇贵金属反佣', name: '💹・市场演算' },
      { id: '1558677883193397258', expectedName: 'cfd自营推荐', name: '🏢・自营机构档案' },
      { id: '1545734159593377932', expectedName: '宏观推送', name: '📡・宏观情报' },
      { id: '1545732134499647629', expectedName: '网站资讯', name: '🌐・网站资讯' },
      { id: '1545734389114077184', expectedName: '建议提交', name: '🧬・树状图提案所' },
      { id: '1545734517371969616', expectedName: '网站建议', name: '📝・网站改进提案' },
      { id: '1545782144998051933', expectedName: '虚数学区', name: '🌀・虚数学区' },
      { id: '1545852514942062652', expectedName: '看番', name: '📺・番剧放映室' },
      { id: '1545731928861311057', expectedName: '语音频道', name: '🎙️・广播与茶话' },
      { id: '1545731928861311059', expectedName: '茶话室', name: '☕・茶话室' }
    ]
  );
  assert.deepEqual(
    SCIENCE_GROWTH_ROLE_CHANGES.map(({ stage, expectedName, name, permissions, iconKey }) => ({
      stage, expectedName, name, permissions, iconKey
    })),
    [
      { stage: 0, expectedName: 'Lv1', name: 'Level 0｜无能力者', permissions: '0', iconKey: 'stage-1' },
      { stage: 1, expectedName: 'Lv2', name: 'Level 1｜低能力者', permissions: '0', iconKey: 'stage-2' },
      { stage: 2, expectedName: 'Lv3', name: 'Level 2｜异能力者', permissions: '0', iconKey: 'stage-3' },
      { stage: 3, expectedName: 'Lv4', name: 'Level 3｜强能力者', permissions: '0', iconKey: 'stage-4' },
      { stage: 4, expectedName: 'Lv5', name: 'Level 4｜大能力者', permissions: '0', iconKey: 'stage-5' },
      { stage: 5, expectedName: 'Lv6', name: 'Level 5｜超能力者', permissions: '0', iconKey: 'stage-6' }
    ]
  );
  assert.deepEqual(
    MAGIC_GROWTH_ROLE_DEFINITIONS.map(({ stage, key, name, permissions, iconKey }) => ({
      stage, key, name, permissions, iconKey
    })),
    [
      { stage: 0, key: 'magic-stage-0', name: '阶位 0｜魔法学徒', permissions: '0', iconKey: 'magic-stage-1' },
      { stage: 1, key: 'magic-stage-1', name: '阶位 1｜见习魔法师', permissions: '0', iconKey: 'magic-stage-2' },
      { stage: 2, key: 'magic-stage-2', name: '阶位 2｜正式魔法师', permissions: '0', iconKey: 'magic-stage-3' },
      { stage: 3, key: 'magic-stage-3', name: '阶位 3｜高阶魔法师', permissions: '0', iconKey: 'magic-stage-4' },
      { stage: 4, key: 'magic-stage-4', name: '阶位 4｜大魔法师', permissions: '0', iconKey: 'magic-stage-5' },
      { stage: 5, key: 'magic-stage-5', name: '阶位 5｜魔神候补', permissions: '0', iconKey: 'magic-stage-6' }
    ]
  );
  assert.deepEqual(
    GROWTH_ROLE_CHANGES.map(({ expectedName, name }) => ({ expectedName, name })),
    [
      { expectedName: 'Lv1', name: 'Level 0｜无能力者' },
      { expectedName: 'Lv2', name: 'Level 1｜低能力者' },
      { expectedName: 'Lv3', name: 'Level 2｜异能力者' },
      { expectedName: 'Lv4', name: 'Level 3｜强能力者' },
      { expectedName: 'Lv5', name: 'Level 4｜大能力者' },
      { expectedName: 'Lv6', name: 'Level 5｜超能力者' },
      { expectedName: '天才少年', name: '原石｜科学侧特异个体' }
    ]
  );
  assert.deepEqual(
    IDENTITY_ROLE_DEFINITIONS.map(({ key, name }) => ({ key, name })),
    [
      { key: 'esper', name: '科学侧｜能力开发者' },
      { key: 'magician', name: '魔法侧｜术式研习者' },
      { key: 'saint', name: '圣人｜魔法侧特异个体' }
    ]
  );
});

test('validateThemeSnapshot accepts the captured current server', () => {
  assert.deepEqual(validateThemeSnapshot(snapshot), { ok: true, errors: [] });
  const plan = buildThemePlan(snapshot);
  assert.equal(plan.channelPatches.length, CHANNEL_CHANGES.length);
  assert.equal(plan.growthRolePatches.length, GROWTH_ROLE_CHANGES.length);
  assert.equal(plan.identityRoles.length, IDENTITY_ROLE_DEFINITIONS.length);
  assert.equal(plan.magicGrowthRoles.length, MAGIC_GROWTH_ROLE_DEFINITIONS.length);
  assert.deepEqual(plan.magicGrowthRolePatches, []);
});

test('validation rejects a renamed channel before producing patches', () => {
  const drifted = clone(snapshot);
  drifted.channels.find(({ id }) => id === CHANNEL_CHANGES[0].id).name = '未知频道名';

  const result = validateThemeSnapshot(drifted);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /1545734710888632411/);
  assert.throws(() => buildThemePlan(drifted), /主题快照校验失败/);
});

test('validation rejects a changed parent category and a missing role', () => {
  const drifted = clone(snapshot);
  drifted.channels.find(({ id }) => id === '1545731928861311058').parentId = null;
  drifted.roles = drifted.roles.filter(({ id }) => id !== GROWTH_ROLE_CHANGES[0].id);

  const result = validateThemeSnapshot(drifted);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /1545731928861311058/);
  assert.match(result.errors.join('\n'), new RegExp(GROWTH_ROLE_CHANGES[0].id));
});

test('validation accepts an already-applied snapshot and produces no duplicate patches', () => {
  const applied = makeAppliedSnapshot();
  for (const role of applied.roles.filter(role => role.id.startsWith('identity-'))) {
    role.icon = `theme-${role.id}`;
  }

  assert.deepEqual(validateThemeSnapshot(applied), { ok: true, errors: [] });
  const plan = buildThemePlan(applied, roleIconHashes(applied));
  assert.deepEqual(plan.channelPatches, []);
  assert.deepEqual(plan.growthRolePatches, []);
  assert.deepEqual(plan.identityRoles, []);
  assert.deepEqual(plan.identityRolePatches, []);
  assert.deepEqual(plan.magicGrowthRoles, []);
  assert.deepEqual(plan.magicGrowthRolePatches, []);
});

test('validation accepts the deployed neutral growth names as a migration source', () => {
  const deployed = clone(snapshot);
  const neutralNames = [
    '阶段 I｜入学者',
    '阶段 II｜研习者',
    '阶段 III｜实践者',
    '阶段 IV｜精英',
    '阶段 V｜领域者',
    '阶段 VI｜特异点'
  ];
  SCIENCE_GROWTH_ROLE_CHANGES.forEach((change, index) => {
    const role = deployed.roles.find(({ id }) => id === change.id);
    role.name = neutralNames[index];
    role.color = change.color;
  });

  assert.deepEqual(validateThemeSnapshot(deployed), { ok: true, errors: [] });
  const plan = buildThemePlan(deployed);
  assert.deepEqual(
    plan.growthRolePatches.slice(0, 6).map(({ id, name }) => ({ id, name })),
    SCIENCE_GROWTH_ROLE_CHANGES.map(({ id, name }) => ({ id, name }))
  );
});

test('an existing magic growth role with a nonmatching icon remains pending for repair', () => {
  const applied = makeAppliedSnapshot();
  const target = applied.roles.find(({ name }) => name === MAGIC_GROWTH_ROLE_DEFINITIONS[0].name);
  const expected = roleIconHashes(applied);
  expected[target.id] = 'expected-magic-icon';

  const plan = buildThemePlan(applied, expected);

  assert.deepEqual(plan.magicGrowthRolePatches, [{
    id: target.id,
    key: MAGIC_GROWTH_ROLE_DEFINITIONS[0].key,
    iconKey: MAGIC_GROWTH_ROLE_DEFINITIONS[0].iconKey
  }]);
});

test('persisted magic growth role ids repair renamed roles instead of creating replacements', () => {
  const applied = makeAppliedSnapshot();
  const magicRoleIds = magicGrowthRoleIds(applied);
  const target = applied.roles.find(({ id }) => id === magicRoleIds[0]);
  target.name = 'renamed-magic-stage';
  target.color = 0;

  const plan = buildThemePlan(applied, roleIconHashes(applied), magicRoleIds);

  assert.deepEqual(plan.magicGrowthRoles, []);
  assert.deepEqual(plan.magicGrowthRolePatches, [{
    id: magicRoleIds[0],
    key: MAGIC_GROWTH_ROLE_DEFINITIONS[0].key,
    iconKey: MAGIC_GROWTH_ROLE_DEFINITIONS[0].iconKey,
    name: MAGIC_GROWTH_ROLE_DEFINITIONS[0].name,
    color: MAGIC_GROWTH_ROLE_DEFINITIONS[0].color
  }]);
});

test('persisted magic growth role ids fail safely when a recorded role is missing', () => {
  const applied = makeAppliedSnapshot();
  const magicRoleIds = magicGrowthRoleIds(applied);
  applied.roles = applied.roles.filter(({ id }) => id !== magicRoleIds[0]);

  assert.throws(
    () => buildThemePlan(applied, roleIconHashes(applied), magicRoleIds),
    new RegExp(magicRoleIds[0])
  );
});

test('an applied role with a nonmatching icon remains pending for repair', () => {
  const applied = makeAppliedSnapshot();
  const target = applied.roles.find(({ id }) => id === GROWTH_ROLE_CHANGES[0].id);
  const expected = roleIconHashes(applied);
  expected[target.id] = 'expected-theme-icon';

  const plan = buildThemePlan(applied, expected);

  assert.equal(plan.growthRolePatches.some(({ id }) => id === target.id), true);
});

test('an applied growth role with a missing icon remains pending for repair', () => {
  const applied = makeAppliedSnapshot();
  const expectedIcons = roleIconHashes(applied);
  const target = applied.roles.find(({ id }) => id === GROWTH_ROLE_CHANGES[0].id);
  target.icon = null;
  target.unicodeEmoji = null;

  const plan = buildThemePlan(applied, expectedIcons);
  assert.deepEqual(plan.growthRolePatches, [{
    id: GROWTH_ROLE_CHANGES[0].id,
    iconKey: GROWTH_ROLE_CHANGES[0].iconKey
  }]);
});

test('validation tolerates unrelated extra roles but rejects duplicate identity roles', () => {
  const extra = clone(snapshot);
  extra.roles.push({
    id: 'unrelated-role',
    name: '无关角色',
    color: 0,
    position: 1,
    permissions: '0',
    managed: false,
    icon: null,
    unicodeEmoji: null
  });
  assert.deepEqual(validateThemeSnapshot(extra), { ok: true, errors: [] });

  const duplicate = makeAppliedSnapshot();
  duplicate.roles.push({
    ...duplicate.roles.find(({ name }) => name === '科学侧｜能力开发者'),
    id: 'duplicate-esper'
  });
  const result = validateThemeSnapshot(duplicate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /科学侧｜能力开发者/);
});

test('the manifest never targets server-hub or managed roles', () => {
  assert.equal(CHANNEL_CHANGES.some(({ id }) => id === '1568415139131170841'), false);
  const managedRoleIds = new Set(snapshot.roles.filter(({ managed }) => managed).map(({ id }) => id));
  assert.equal(GROWTH_ROLE_CHANGES.some(({ id }) => managedRoleIds.has(id)), false);
});

test('identity roles have zero permissions and distinct names', () => {
  assert.equal(IDENTITY_ROLE_DEFINITIONS.every(({ permissions }) => permissions === '0'), true);
  const names = IDENTITY_ROLE_DEFINITIONS.map(({ name }) => name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(IDENTITY_ROLE_DEFINITIONS.map(({ key }) => key)).size, 3);
});

test('welcome payload uses raw REST mention suppression and explains rules and equal-permission routes', () => {
  const payload = buildWelcomePayload({
    flower: '1545731928861311058',
    tools: '1545734021630132304',
    virtual: '1545782144998051933',
    voice: '1545731928861311057'
  });

  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal('allowedMentions' in payload, false);
  assert.ok(Array.isArray(payload.embeds));
  const text = JSON.stringify(payload);
  assert.match(text, /学园都市入学登记/);
  assert.match(text, /科学侧/);
  assert.match(text, /魔法侧/);
  assert.match(text, /相同|一致|不影响权限/);
  assert.match(text, /\/档案/);
  assert.match(text, /\/设置档案/);
  assert.match(text, /\/选择路线/);
  assert.match(text, /规则/);
  for (const channelId of ['1545731928861311058', '1545734021630132304', '1545782144998051933', '1545731928861311057']) {
    assert.match(text, new RegExp(channelId));
  }
});

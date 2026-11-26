'use strict';

const TARGET_GUILD_ID = '1545731927733047306';

function freezeList(items) {
  return Object.freeze(items.map((item) => Object.freeze(item)));
}

const CHANNEL_CHANGES = freezeList([
  {
    id: '1545734710888632411',
    expectedName: '欢迎悠の茶话会',
    name: '📜・入学登记处',
    expectedParentId: null,
    expectedType: 0,
    expectedTopic: null,
    topic: '欢迎来到悠の学园都市。请从这里查看规则、频道导航与科学侧/魔法侧档案说明。'
  },
  {
    id: '1545731928861311056',
    expectedName: '悠の茶话会',
    name: '🌸・悠の茶话会',
    expectedParentId: null,
    expectedType: 4
  },
  {
    id: '1545731928861311058',
    expectedName: '悠の花园',
    name: '🌿・悠の花园',
    expectedParentId: '1545731928861311056',
    expectedType: 0,
    expectedTopic: null,
    topic: '学园都市的日常茶话区，自由聊天与分享生活。'
  },
  {
    id: '1558681467268239482',
    expectedName: '学园都市',
    name: '🏙️・学园都市',
    expectedParentId: '1545731928861311056',
    expectedType: 0,
    expectedTopic: null,
    topic: '服务器主题交流、社区动态与世界观话题。'
  },
  {
    id: '1545734021630132304',
    expectedName: '悠の小工具',
    name: '⚙️・演算终端',
    expectedParentId: null,
    expectedType: 4
  },
  {
    id: '1546525345358811246',
    expectedName: '股指外汇贵金属反佣',
    name: '💹・市场演算',
    expectedParentId: '1545734021630132304',
    expectedType: 0,
    expectedTopic: null,
    topic: '股指、外汇、贵金属与相关服务信息。'
  },
  {
    id: '1558677883193397258',
    expectedName: 'cfd自营推荐',
    name: '🏢・自营机构档案',
    expectedParentId: '1545734021630132304',
    expectedType: 0,
    expectedTopic: null,
    topic: 'CFD 自营机构资料与推荐。'
  },
  {
    id: '1545734159593377932',
    expectedName: '宏观推送',
    name: '📡・宏观情报',
    expectedParentId: '1545734021630132304',
    expectedType: 0,
    expectedTopic: null,
    topic: '宏观市场与重要数据自动推送。'
  },
  {
    id: '1545732134499647629',
    expectedName: '网站资讯',
    name: '🌐・网站资讯',
    expectedParentId: '1545734021630132304',
    expectedType: 0,
    expectedTopic: null,
    topic: '网站公告、更新与服务资讯。'
  },
  {
    id: '1545734389114077184',
    expectedName: '建议提交',
    name: '🧬・树状图提案所',
    expectedParentId: null,
    expectedType: 4
  },
  {
    id: '1545734517371969616',
    expectedName: '网站建议',
    name: '📝・网站改进提案',
    expectedParentId: '1545734389114077184',
    expectedType: 0,
    expectedTopic: '提交对网站的建议和优化',
    topic: '提交网站功能、体验和优化建议。'
  },
  {
    id: '1545782144998051933',
    expectedName: '虚数学区',
    name: '🌀・虚数学区',
    expectedParentId: null,
    expectedType: 4
  },
  {
    id: '1545852514942062652',
    expectedName: '看番',
    name: '📺・番剧放映室',
    expectedParentId: '1545782144998051933',
    expectedType: 0,
    expectedTopic: null,
    topic: '番剧讨论、放映安排和观后交流。'
  },
  {
    id: '1545731928861311057',
    expectedName: '语音频道',
    name: '🎙️・广播与茶话',
    expectedParentId: null,
    expectedType: 4
  },
  {
    id: '1545731928861311059',
    expectedName: '茶话室',
    name: '☕・茶话室',
    expectedParentId: '1545731928861311057',
    expectedType: 2
  }
]);

const SCIENCE_GROWTH_ROLE_CHANGES = freezeList([
  {
    stage: 0,
    id: '1545732410576998431',
    expectedName: 'Lv1',
    previousName: '阶段 I｜入学者',
    name: 'Level 0｜无能力者',
    expectedColor: 5025232,
    color: 7041664,
    expectedPermissions: '0',
    permissions: '0',
    iconKey: 'stage-1'
  },
  {
    stage: 1,
    id: '1545732479200268349',
    expectedName: 'Lv2',
    previousName: '阶段 II｜研习者',
    name: 'Level 1｜低能力者',
    expectedColor: 10382335,
    color: 8246268,
    expectedPermissions: '0',
    permissions: '0',
    iconKey: 'stage-2'
  },
  {
    stage: 2,
    id: '1545732541049208852',
    expectedName: 'Lv3',
    previousName: '阶段 III｜实践者',
    name: 'Level 2｜异能力者',
    expectedColor: 16735702,
    color: 3718648,
    expectedPermissions: '0',
    permissions: '0',
    iconKey: 'stage-3'
  },
  {
    stage: 3,
    id: '1545732587534819338',
    expectedName: 'Lv4',
    previousName: '阶段 IV｜精英',
    name: 'Level 3｜强能力者',
    expectedColor: 9467253,
    color: 3900150,
    expectedPermissions: '0',
    permissions: '0',
    iconKey: 'stage-4'
  },
  {
    stage: 4,
    id: '1545732627221446766',
    expectedName: 'Lv5',
    previousName: '阶段 V｜领域者',
    name: 'Level 4｜大能力者',
    expectedColor: 11127295,
    color: 9133302,
    expectedPermissions: '0',
    permissions: '0',
    iconKey: 'stage-5'
  },
  {
    stage: 5,
    id: '1545732685190930523',
    expectedName: 'Lv6',
    previousName: '阶段 VI｜特异点',
    name: 'Level 5｜超能力者',
    expectedColor: 10181046,
    color: 14993002,
    expectedPermissions: '0',
    permissions: '0',
    iconKey: 'stage-6'
  }
]);

const GROWTH_ROLE_CHANGES = freezeList([
  ...SCIENCE_GROWTH_ROLE_CHANGES,
  {
    id: '1545732689347354666',
    expectedName: '天才少年',
    name: '原石｜科学侧特异个体',
    expectedColor: 11127295,
    color: 5621747,
    expectedPermissions: '8864258447638527',
    iconKey: 'special-gemstone'
  }
]);

const MAGIC_GROWTH_ROLE_DEFINITIONS = freezeList([
  {
    stage: 0,
    key: 'magic-stage-0',
    name: '阶位 0｜魔法学徒',
    color: 0x6b7280,
    permissions: '0',
    iconKey: 'magic-stage-1'
  },
  {
    stage: 1,
    key: 'magic-stage-1',
    name: '阶位 1｜见习魔法师',
    color: 0xa78bfa,
    permissions: '0',
    iconKey: 'magic-stage-2'
  },
  {
    stage: 2,
    key: 'magic-stage-2',
    name: '阶位 2｜正式魔法师',
    color: 0x8b5cf6,
    permissions: '0',
    iconKey: 'magic-stage-3'
  },
  {
    stage: 3,
    key: 'magic-stage-3',
    name: '阶位 3｜高阶魔法师',
    color: 0x7c3aed,
    permissions: '0',
    iconKey: 'magic-stage-4'
  },
  {
    stage: 4,
    key: 'magic-stage-4',
    name: '阶位 4｜大魔法师',
    color: 0x6d28d9,
    permissions: '0',
    iconKey: 'magic-stage-5'
  },
  {
    stage: 5,
    key: 'magic-stage-5',
    name: '阶位 5｜魔神候补',
    color: 0xe4c66a,
    permissions: '0',
    iconKey: 'magic-stage-6'
  }
]);

const IDENTITY_ROLE_DEFINITIONS = freezeList([
  {
    key: 'esper',
    name: '科学侧｜能力开发者',
    color: 5621747,
    permissions: '0',
    iconKey: 'route-esper'
  },
  {
    key: 'magician',
    name: '魔法侧｜术式研习者',
    color: 9133302,
    permissions: '0',
    iconKey: 'route-magician'
  },
  {
    key: 'saint',
    name: '圣人｜魔法侧特异个体',
    color: 12163826,
    permissions: '0',
    iconKey: 'special-saint'
  }
]);

function buildWelcomePayload(channelIds) {
  const navigation = [
    `🌿 日常交流：<#${channelIds.flower}>`,
    `⚙️ 工具与资讯：<#${channelIds.tools}>`,
    `🌀 兴趣分区：<#${channelIds.virtual}>`,
    `🎙️ 语音区域：<#${channelIds.voice}>`
  ].join('\n');

  return {
    content: '欢迎办理学园都市入学登记。',
    embeds: [
      {
        color: 5621747,
        title: '📜 学园都市入学登记',
        description: [
          '这里是科学与魔法并存的「悠の学园都市」。完成档案后即可开始探索。',
          '',
          navigation
        ].join('\n'),
        fields: [
          {
            name: '入学规则',
            value: '友善交流，不刷屏、不骚扰；发布内容请遵守 Discord 社区准则和所在频道说明。'
          },
          {
            name: '档案指令',
            value: '`/档案` 查看资料 · `/设置档案` 完善资料 · `/选择路线` 选择身份'
          },
          {
            name: '路线说明',
            value: '「科学侧」与「魔法侧」只改变身份展示和主题视觉，权限完全相同，不影响任何频道访问。'
          }
        ],
        footer: {
          text: '悠の学园都市 · INDEX_THEME_WELCOME_V1'
        }
      }
    ],
    allowed_mentions: { parse: [] }
  };
}

function validateThemeSnapshot(snapshot, magicGrowthRoleIds = []) {
  const errors = [];

  if (!snapshot || snapshot.guild?.id !== TARGET_GUILD_ID) {
    errors.push(`服务器 ID 不匹配：应为 ${TARGET_GUILD_ID}`);
  }

  const channelsById = new Map((snapshot?.channels || []).map((channel) => [channel.id, channel]));
  for (const change of CHANNEL_CHANGES) {
    const channel = channelsById.get(change.id);
    if (!channel) {
      errors.push(`缺少目标频道 ${change.id}`);
      continue;
    }
    if (channel.name !== change.expectedName && channel.name !== change.name) {
      errors.push(`频道 ${change.id} 名称发生漂移`);
    }
    if (channel.parentId !== change.expectedParentId) {
      errors.push(`频道 ${change.id} 父分类发生漂移`);
    }
    if (channel.type !== change.expectedType) {
      errors.push(`频道 ${change.id} 类型发生漂移`);
    }
    if (
      Object.hasOwn(change, 'topic') &&
      channel.topic !== change.expectedTopic &&
      channel.topic !== change.topic
    ) {
      errors.push(`频道 ${change.id} 说明发生漂移`);
    }
  }

  const rolesById = new Map((snapshot?.roles || []).map((role) => [role.id, role]));
  for (const change of GROWTH_ROLE_CHANGES) {
    const role = rolesById.get(change.id);
    if (!role) {
      errors.push(`缺少目标角色 ${change.id}`);
      continue;
    }
    if (role.managed !== false) {
      errors.push(`角色 ${change.id} 不是可编辑的普通角色`);
    }
    if (![change.expectedName, change.previousName, change.name].filter(Boolean).includes(role.name)) {
      errors.push(`角色 ${change.id} 名称发生漂移`);
    }
    if (role.color !== change.expectedColor && role.color !== change.color) {
      errors.push(`角色 ${change.id} 颜色发生漂移`);
    }
    if (role.permissions !== change.expectedPermissions) {
      errors.push(`角色 ${change.id} 权限发生漂移`);
    }
  }

  const roles = snapshot?.roles || [];
  for (const definition of IDENTITY_ROLE_DEFINITIONS) {
    const matches = roles.filter(({ name }) => name === definition.name);
    if (matches.length > 1) {
      errors.push(`身份角色「${definition.name}」重复存在`);
      continue;
    }
    if (matches.length === 1) {
      const [role] = matches;
      if (role.managed !== false) errors.push(`身份角色「${definition.name}」不能是托管角色`);
      if (role.permissions !== definition.permissions) errors.push(`身份角色「${definition.name}」权限必须为 0`);
      if (role.color !== definition.color) errors.push(`身份角色「${definition.name}」颜色发生漂移`);
    }
  }

  const stableMagicRoleIdsValid = Array.isArray(magicGrowthRoleIds) &&
    (magicGrowthRoleIds.length === 0 || (
      magicGrowthRoleIds.length === MAGIC_GROWTH_ROLE_DEFINITIONS.length &&
      new Set(magicGrowthRoleIds).size === MAGIC_GROWTH_ROLE_DEFINITIONS.length &&
      magicGrowthRoleIds.every(roleId => typeof roleId === 'string' && roleId.length > 0)
    ));
  if (!stableMagicRoleIdsValid) {
    errors.push('持久化魔法成长角色 ID 必须为空或恰好包含 6 个不同 ID');
  }

  for (const [index, definition] of MAGIC_GROWTH_ROLE_DEFINITIONS.entries()) {
    const stableRoleId = stableMagicRoleIdsValid ? magicGrowthRoleIds[index] : null;
    const matches = roles.filter(({ name }) => name === definition.name);
    if (stableRoleId) {
      const role = rolesById.get(stableRoleId);
      if (!role) {
        errors.push(`缺少持久化魔法成长角色 ${stableRoleId}`);
        continue;
      }
      if (matches.some(({ id }) => id !== stableRoleId)) {
        errors.push(`魔法成长角色「${definition.name}」被无关角色占用`);
      }
      if (role.managed !== false) errors.push(`魔法成长角色 ${stableRoleId} 不能是托管角色`);
      if (role.permissions !== definition.permissions) errors.push(`魔法成长角色 ${stableRoleId} 权限必须为 0`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`魔法成长角色「${definition.name}」重复存在`);
      continue;
    }
    if (matches.length === 1) {
      const [role] = matches;
      if (role.managed !== false) errors.push(`魔法成长角色「${definition.name}」不能是托管角色`);
      if (role.permissions !== definition.permissions) errors.push(`魔法成长角色「${definition.name}」权限必须为 0`);
      if (role.color !== definition.color) errors.push(`魔法成长角色「${definition.name}」颜色发生漂移`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function buildThemePlan(snapshot, expectedRoleIcons = {}, magicGrowthRoleIds = []) {
  const validation = validateThemeSnapshot(snapshot, magicGrowthRoleIds);
  if (!validation.ok) {
    throw new Error(`主题快照校验失败：\n- ${validation.errors.join('\n- ')}`);
  }

  const channelsById = new Map(snapshot.channels.map((channel) => [channel.id, channel]));
  const rolesById = new Map(snapshot.roles.map((role) => [role.id, role]));
  const existingRoleNames = new Set(snapshot.roles.map((role) => role.name));

  const channelPatches = CHANNEL_CHANGES.flatMap((change) => {
    const channel = channelsById.get(change.id);
    const patch = { id: change.id };
    if (channel.name !== change.name) patch.name = change.name;
    if (Object.hasOwn(change, 'topic') && channel.topic !== change.topic) patch.topic = change.topic;
    return Object.keys(patch).length > 1 ? [patch] : [];
  });

  const growthRolePatches = GROWTH_ROLE_CHANGES.flatMap((change) => {
    const role = rolesById.get(change.id);
    const patch = { id: change.id, iconKey: change.iconKey };
    if (role.name !== change.name) patch.name = change.name;
    if (role.color !== change.color) patch.color = change.color;
    const expectedIcon = expectedRoleIcons[role.id];
    const iconNeedsRepair = !expectedIcon || role.icon !== expectedIcon;
    return Object.keys(patch).length > 2 || iconNeedsRepair ? [patch] : [];
  });

  const identityRoles = IDENTITY_ROLE_DEFINITIONS
    .filter(({ name }) => !existingRoleNames.has(name))
    .map((definition) => ({ ...definition }));
  const identityRolePatches = IDENTITY_ROLE_DEFINITIONS.flatMap(definition => {
    const role = snapshot.roles.find(candidate => candidate.name === definition.name);
    if (!role) return [];
    const expectedIcon = expectedRoleIcons[role.id];
    return !expectedIcon || role.icon !== expectedIcon
      ? [{ id: role.id, key: definition.key, iconKey: definition.iconKey }]
      : [];
  });
  const hasStableMagicRoleIds = magicGrowthRoleIds.length > 0;
  const magicGrowthRoles = hasStableMagicRoleIds
    ? []
    : MAGIC_GROWTH_ROLE_DEFINITIONS
      .filter(({ name }) => !existingRoleNames.has(name))
      .map(definition => ({ ...definition }));
  const magicGrowthRolePatches = MAGIC_GROWTH_ROLE_DEFINITIONS.flatMap((definition, index) => {
    const stableRoleId = hasStableMagicRoleIds ? magicGrowthRoleIds[index] : null;
    const role = stableRoleId
      ? rolesById.get(stableRoleId)
      : snapshot.roles.find(candidate => candidate.name === definition.name);
    if (!role) return [];
    const patch = {
      id: role.id,
      key: definition.key,
      iconKey: definition.iconKey
    };
    if (role.name !== definition.name) patch.name = definition.name;
    if (role.color !== definition.color) patch.color = definition.color;
    const expectedIcon = expectedRoleIcons[role.id];
    const iconNeedsRepair = !expectedIcon || role.icon !== expectedIcon;
    return Object.keys(patch).length > 3 || iconNeedsRepair ? [patch] : [];
  });
  const magicGrowthRoleTargetIds = MAGIC_GROWTH_ROLE_DEFINITIONS.flatMap((definition, index) => {
    const stableRoleId = hasStableMagicRoleIds ? magicGrowthRoleIds[index] : null;
    const role = stableRoleId
      ? rolesById.get(stableRoleId)
      : snapshot.roles.find(candidate => candidate.name === definition.name);
    return role ? [role.id] : [];
  });

  return {
    channelPatches,
    growthRolePatches,
    identityRoles,
    identityRolePatches,
    magicGrowthRoles,
    magicGrowthRolePatches,
    magicGrowthRoleTargetIds,
    welcomePayload: buildWelcomePayload({
      flower: '1545731928861311058',
      tools: '1545734021630132304',
      virtual: '1545782144998051933',
      voice: '1545731928861311057'
    })
  };
}

module.exports = {
  TARGET_GUILD_ID,
  CHANNEL_CHANGES,
  GROWTH_ROLE_CHANGES,
  SCIENCE_GROWTH_ROLE_CHANGES,
  MAGIC_GROWTH_ROLE_DEFINITIONS,
  IDENTITY_ROLE_DEFINITIONS,
  buildWelcomePayload,
  validateThemeSnapshot,
  buildThemePlan
};

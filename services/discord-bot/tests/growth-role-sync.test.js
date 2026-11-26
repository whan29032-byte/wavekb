'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { syncGrowthRole } = require('../growth-role-sync');

const growthRoles = {
  guildId: 'guild-theme',
  esperRoleIds: ['s0', 's1', 's2', 's3', 's4', 's5'],
  magicianRoleIds: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']
};

function createMember({ roleIds = [], addError = null, removeErrorAt = null } = {}) {
  const current = new Set(roleIds);
  const calls = [];
  let removeCount = 0;
  return {
    member: {
      roles: {
        cache: { has: roleId => current.has(roleId) },
        async add(roleId) {
          calls.push(['add', roleId]);
          if (addError) throw addError;
          current.add(roleId);
        },
        async remove(roleId) {
          calls.push(['remove', roleId]);
          removeCount += 1;
          if (removeErrorAt === removeCount) throw new Error('remove failed');
          current.delete(roleId);
        },
        async set() {
          throw new Error('roles.set must never be used');
        }
      }
    },
    current,
    calls
  };
}

test('maps profile levels 1 through 6 to stages 0 through 5 and clamps higher levels', async () => {
  const cases = [
    { path: 'esper', level: 1, expected: 's0' },
    { path: 'esper', level: 2, expected: 's1' },
    { path: 'magician', level: 6, expected: 'm5' },
    { path: 'magician', level: 99, expected: 'm5' }
  ];

  for (const entry of cases) {
    const fake = createMember();
    const result = await syncGrowthRole({
      member: fake.member,
      guildId: 'guild-theme',
      path: entry.path,
      level: entry.level,
      growthRoles
    });
    assert.equal(result.status, 'synced');
    assert.equal(result.targetRoleId, entry.expected);
    assert.deepEqual([...fake.current], [entry.expected]);
  }
});
test('adds the selected growth role before removing every stale track role', async () => {
  const fake = createMember({ roleIds: ['s2', 'm1', 'unrelated'] });

  const result = await syncGrowthRole({
    member: fake.member,
    guildId: 'guild-theme',
    path: 'magician',
    level: 3,
    growthRoles
  });

  assert.deepEqual(fake.calls, [['add', 'm2'], ['remove', 's2'], ['remove', 'm1']]);
  assert.deepEqual([...fake.current].sort(), ['m2', 'unrelated']);
  assert.deepEqual(result, {
    status: 'synced',
    targetRoleId: 'm2',
    added: true,
    removedRoleIds: ['s2', 'm1']
  });
});

test('does not remove an old growth role when adding the target fails', async () => {
  const fake = createMember({ roleIds: ['s0'], addError: new Error('hierarchy') });

  const result = await syncGrowthRole({
    member: fake.member,
    guildId: 'guild-theme',
    path: 'magician',
    level: 1,
    growthRoles
  });

  assert.deepEqual(fake.calls, [['add', 'm0']]);
  assert.deepEqual([...fake.current], ['s0']);
  assert.deepEqual(result, {
    status: 'failed',
    reason: 'add_failed',
    targetRoleId: 'm0',
    added: false,
    removedRoleIds: []
  });
});

test('reports a retryable partial failure with the stale roles already removed', async () => {
  const fake = createMember({ roleIds: ['m3', 's1', 's2'], removeErrorAt: 2 });

  const result = await syncGrowthRole({
    member: fake.member,
    guildId: 'guild-theme',
    path: 'magician',
    level: 4,
    growthRoles
  });

  assert.deepEqual(fake.calls, [['remove', 's1'], ['remove', 's2']]);
  assert.deepEqual([...fake.current].sort(), ['m3', 's2']);
  assert.deepEqual(result, {
    status: 'failed',
    reason: 'remove_failed',
    targetRoleId: 'm3',
    added: false,
    removedRoleIds: ['s1']
  });
});

test('is idempotent and never replaces unrelated roles', async () => {
  const fake = createMember({ roleIds: ['s4', 'unrelated-a', 'unrelated-b'] });

  const result = await syncGrowthRole({
    member: fake.member,
    guildId: 'guild-theme',
    path: 'esper',
    level: 5,
    growthRoles
  });

  assert.deepEqual(fake.calls, []);
  assert.equal(result.status, 'already_synced');
  assert.deepEqual([...fake.current].sort(), ['s4', 'unrelated-a', 'unrelated-b']);
});

test('skips other guilds and rejects invalid configuration or unavailable members without writes', async () => {
  const fake = createMember({ roleIds: ['s0'] });
  assert.equal((await syncGrowthRole({
    member: fake.member,
    guildId: 'other-guild',
    path: 'esper',
    level: 1,
    growthRoles
  })).status, 'skipped');
  assert.equal((await syncGrowthRole({
    member: fake.member,
    guildId: 'guild-theme',
    path: 'unknown',
    level: 1,
    growthRoles
  })).reason, 'invalid_config');
  assert.equal((await syncGrowthRole({
    member: {},
    guildId: 'guild-theme',
    path: 'esper',
    level: 1,
    growthRoles
  })).reason, 'member_unavailable');
  assert.deepEqual(fake.calls, []);
});

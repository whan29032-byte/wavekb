'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { syncRouteRole } = require('../route-role-sync');

const ROUTE_ROLES = {
  guildId: 'guild-1',
  esperRoleId: 'role-esper',
  magicianRoleId: 'role-magician'
};

function createMember({ roleIds = [], addError = null, removeError = null } = {}) {
  const current = new Set(roleIds);
  const calls = [];
  const roles = {
    cache: {
      has(roleId) {
        return current.has(roleId);
      }
    },
    async add(roleId) {
      calls.push(['add', roleId]);
      if (addError) throw addError;
      current.add(roleId);
    },
    async remove(roleId) {
      calls.push(['remove', roleId]);
      if (removeError) throw removeError;
      current.delete(roleId);
    },
    async set() {
      throw new Error('roles.set must never be used');
    }
  };
  return { member: { roles }, calls, current };
}

test('adds the selected role before removing the opposite role', async () => {
  const fake = createMember({ roleIds: ['role-magician', 'unrelated'] });

  const result = await syncRouteRole({
    member: fake.member,
    guildId: 'guild-1',
    path: 'esper',
    routeRoles: ROUTE_ROLES
  });

  assert.deepEqual(fake.calls, [
    ['add', 'role-esper'],
    ['remove', 'role-magician']
  ]);
  assert.deepEqual(result, { status: 'synced', added: true, removed: true });
  assert.equal(fake.current.has('unrelated'), true);
});

test('does not remove the old role when adding the new role fails', async () => {
  const fake = createMember({
    roleIds: ['role-magician'],
    addError: new Error('missing permission')
  });

  const result = await syncRouteRole({
    member: fake.member,
    guildId: 'guild-1',
    path: 'esper',
    routeRoles: ROUTE_ROLES
  });

  assert.deepEqual(fake.calls, [['add', 'role-esper']]);
  assert.deepEqual(result, {
    status: 'failed',
    reason: 'add_failed',
    added: false,
    removed: false
  });
  assert.equal(fake.current.has('role-magician'), true);
});

test('returns a retryable partial failure when removal fails', async () => {
  const fake = createMember({
    roleIds: ['role-magician'],
    removeError: new Error('role hierarchy')
  });

  const result = await syncRouteRole({
    member: fake.member,
    guildId: 'guild-1',
    path: 'esper',
    routeRoles: ROUTE_ROLES
  });

  assert.deepEqual(fake.calls, [
    ['add', 'role-esper'],
    ['remove', 'role-magician']
  ]);
  assert.deepEqual(result, {
    status: 'failed',
    reason: 'remove_failed',
    added: true,
    removed: false
  });
  assert.equal(fake.current.has('role-esper'), true);
  assert.equal(fake.current.has('role-magician'), true);
});

test('repeating the same selection repairs a missing or duplicate role', async () => {
  const missing = createMember();
  assert.deepEqual(await syncRouteRole({
    member: missing.member,
    guildId: 'guild-1',
    path: 'esper',
    routeRoles: ROUTE_ROLES
  }), { status: 'synced', added: true, removed: false });

  const duplicate = createMember({ roleIds: ['role-esper', 'role-magician'] });
  assert.deepEqual(await syncRouteRole({
    member: duplicate.member,
    guildId: 'guild-1',
    path: 'esper',
    routeRoles: ROUTE_ROLES
  }), { status: 'synced', added: false, removed: true });
  assert.deepEqual(duplicate.calls, [['remove', 'role-magician']]);

  const already = createMember({ roleIds: ['role-esper'] });
  assert.deepEqual(await syncRouteRole({
    member: already.member,
    guildId: 'guild-1',
    path: 'esper',
    routeRoles: ROUTE_ROLES
  }), { status: 'already_synced', added: false, removed: false });
});

test('skips without writes for another guild or absent configuration', async () => {
  const otherGuild = createMember({ roleIds: ['role-magician'] });
  assert.deepEqual(await syncRouteRole({
    member: otherGuild.member,
    guildId: 'guild-2',
    path: 'esper',
    routeRoles: ROUTE_ROLES
  }), { status: 'skipped' });
  assert.deepEqual(otherGuild.calls, []);

  const absent = createMember({ roleIds: ['role-magician'] });
  assert.deepEqual(await syncRouteRole({
    member: absent.member,
    guildId: 'guild-1',
    path: 'esper',
    routeRoles: null
  }), { status: 'skipped' });
  assert.deepEqual(absent.calls, []);
});

test('reports invalid configuration and unavailable members without writing', async () => {
  const fake = createMember();
  assert.deepEqual(await syncRouteRole({
    member: fake.member,
    guildId: 'guild-1',
    path: 'unknown',
    routeRoles: ROUTE_ROLES
  }), { status: 'failed', reason: 'invalid_config' });
  assert.deepEqual(await syncRouteRole({
    member: null,
    guildId: 'guild-1',
    path: 'esper',
    routeRoles: ROUTE_ROLES
  }), { status: 'failed', reason: 'member_unavailable' });
  assert.deepEqual(fake.calls, []);
});

test('never replaces the full member role set', async () => {
  const fake = createMember({ roleIds: ['role-magician', 'unrelated-a', 'unrelated-b'] });

  await syncRouteRole({
    member: fake.member,
    guildId: 'guild-1',
    path: 'esper',
    routeRoles: ROUTE_ROLES
  });

  assert.equal(fake.current.has('unrelated-a'), true);
  assert.equal(fake.current.has('unrelated-b'), true);
  assert.deepEqual(fake.calls.map(([operation]) => operation), ['add', 'remove']);
});

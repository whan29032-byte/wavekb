'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionsBitField } = require('discord.js');
const { syncWebsiteRoles } = require('../website-role-sync');

const GUILD_ID = '1545731927733047306';
const LINKED_ROLE_ID = '1545731927733047307';
const TITLE_ROLE_ID = '1545731927733047308';
const STALE_ROLE_ID = '1545731927733047309';
const UNRELATED_ROLE_ID = '1545731927733047310';
const BOT_ROLE_ID = '1545731927733047311';

const integration = {
  guildId: GUILD_ID,
  linkedRoleId: LINKED_ROLE_ID,
  titleRoleMap: {
    Observer: TITLE_ROLE_ID,
    Researcher: STALE_ROLE_ID
  }
};

function role({ id, guild, position = 10, managed = false, permissions = [] }) {
  return {
    id,
    guild,
    name: id === guild.id ? '@everyone' : `role-${id}`,
    position,
    rawPosition: position,
    managed,
    permissions: new PermissionsBitField(permissions),
    comparePositionTo(other) {
      return this.position - other.position;
    }
  };
}

function createMember(initialRoleIds = [], options = {}) {
  const actions = [];
  const guild = {
    id: GUILD_ID,
    roles: { cache: new Collection(), everyone: null },
    members: { me: null }
  };
  const everyone = role({ id: GUILD_ID, guild, position: 0 });
  guild.roles.everyone = everyone;
  guild.roles.cache.set(everyone.id, everyone);

  for (const [id, position] of [
    [LINKED_ROLE_ID, 10],
    [TITLE_ROLE_ID, 20],
    [STALE_ROLE_ID, 30],
    [UNRELATED_ROLE_ID, 40]
  ]) {
    guild.roles.cache.set(id, role({ id, guild, position }));
  }

  const botHighest = role({ id: BOT_ROLE_ID, guild, position: options.botPosition ?? 100 });
  guild.roles.cache.set(BOT_ROLE_ID, botHighest);
  guild.members.me = { guild, roles: { highest: botHighest } };

  for (const [id, override] of Object.entries(options.roleOverrides || {})) {
    const existing = guild.roles.cache.get(id) || role({ id, guild });
    guild.roles.cache.set(id, { ...existing, ...override });
  }
  for (const id of options.missingGuildRoleIds || []) guild.roles.cache.delete(id);

  const memberRoles = new Collection();
  for (const id of initialRoleIds) {
    const current = guild.roles.cache.get(id) || role({ id, guild });
    memberRoles.set(id, current);
  }

  const member = {
    guild,
    roles: {
      cache: memberRoles,
      async add(roleId) {
        actions.push(['add', roleId]);
        if (roleId === options.addFailure) throw new Error('add failed');
        memberRoles.set(roleId, guild.roles.cache.get(roleId));
      },
      async remove(roleId) {
        actions.push(['remove', roleId]);
        if (roleId === options.removeFailure) throw new Error('remove failed');
        memberRoles.delete(roleId);
      }
    }
  };
  return { member, guild, actions, roleIds: memberRoles };
}

test('adds the linked and current title roles before removing stale mapped roles', async () => {
  const fixture = createMember([STALE_ROLE_ID, UNRELATED_ROLE_ID]);
  const result = await syncWebsiteRoles({
    member: fixture.member,
    guildId: integration.guildId,
    profile: { displayTitle: 'Observer' },
    integration
  });

  assert.deepEqual(fixture.actions, [
    ['add', LINKED_ROLE_ID],
    ['add', TITLE_ROLE_ID],
    ['remove', STALE_ROLE_ID]
  ]);
  assert.equal(fixture.roleIds.has(UNRELATED_ROLE_ID), true);
  assert.deepEqual(result, {
    status: 'synced',
    addedRoleIds: [LINKED_ROLE_ID, TITLE_ROLE_ID],
    removedRoleIds: [STALE_ROLE_ID]
  });
});

test('is idempotent when the configured website roles already match', async () => {
  const fixture = createMember([LINKED_ROLE_ID, TITLE_ROLE_ID]);
  const result = await syncWebsiteRoles({
    member: fixture.member,
    guildId: integration.guildId,
    profile: { displayTitle: 'Observer' },
    integration
  });
  assert.deepEqual(fixture.actions, []);
  assert.deepEqual(result, {
    status: 'already_synced',
    addedRoleIds: [],
    removedRoleIds: []
  });
});

test('a linked profile with no display title keeps the linked role and removes only title roles', async () => {
  const fixture = createMember([LINKED_ROLE_ID, TITLE_ROLE_ID]);
  const result = await syncWebsiteRoles({
    member: fixture.member,
    guildId: integration.guildId,
    profile: { displayTitle: null },
    integration
  });
  assert.deepEqual(fixture.actions, [['remove', TITLE_ROLE_ID]]);
  assert.equal(fixture.roleIds.has(LINKED_ROLE_ID), true);
  assert.deepEqual(result.removedRoleIds, [TITLE_ROLE_ID]);
});

test('a null profile authoritatively removes only configured website roles', async () => {
  const fixture = createMember([LINKED_ROLE_ID, TITLE_ROLE_ID, STALE_ROLE_ID, UNRELATED_ROLE_ID]);
  const result = await syncWebsiteRoles({
    member: fixture.member,
    guildId: integration.guildId,
    profile: null,
    integration
  });
  assert.deepEqual(fixture.actions, [
    ['remove', LINKED_ROLE_ID],
    ['remove', TITLE_ROLE_ID],
    ['remove', STALE_ROLE_ID]
  ]);
  assert.equal(fixture.roleIds.has(UNRELATED_ROLE_ID), true);
  assert.deepEqual(result, {
    status: 'synced',
    addedRoleIds: [],
    removedRoleIds: [LINKED_ROLE_ID, TITLE_ROLE_ID, STALE_ROLE_ID]
  });
});

test('does not remove stale roles when adding a required role fails', async () => {
  const fixture = createMember([STALE_ROLE_ID], { addFailure: LINKED_ROLE_ID });
  const result = await syncWebsiteRoles({
    member: fixture.member,
    guildId: integration.guildId,
    profile: { displayTitle: 'Observer' },
    integration
  });
  assert.deepEqual(fixture.actions, [['add', LINKED_ROLE_ID]]);
  assert.deepEqual(result, {
    status: 'failed',
    reason: 'add_failed',
    addedRoleIds: [],
    removedRoleIds: []
  });
});

test('reports a partial retryable result when stale title removal fails', async () => {
  const fixture = createMember(
    [LINKED_ROLE_ID, TITLE_ROLE_ID, STALE_ROLE_ID],
    { removeFailure: STALE_ROLE_ID }
  );
  const result = await syncWebsiteRoles({
    member: fixture.member,
    guildId: integration.guildId,
    profile: { displayTitle: 'Observer' },
    integration
  });
  assert.deepEqual(result, {
    status: 'failed',
    reason: 'remove_failed',
    addedRoleIds: [],
    removedRoleIds: []
  });
});

test('skips other guilds and rejects unavailable members without writes', async () => {
  const otherGuild = createMember();
  assert.deepEqual(await syncWebsiteRoles({
    member: otherGuild.member,
    guildId: '999999999999999999',
    profile: { displayTitle: 'Observer' },
    integration
  }), { status: 'skipped' });
  assert.deepEqual(otherGuild.actions, []);

  assert.deepEqual(await syncWebsiteRoles({
    member: null,
    guildId: integration.guildId,
    profile: { displayTitle: 'Observer' },
    integration
  }), { status: 'failed', reason: 'member_unavailable' });
});

test('refuses unsafe target roles before performing any writes', async t => {
  const cases = [
    {
      name: 'missing role',
      options: { missingGuildRoleIds: [TITLE_ROLE_ID] },
      expectedReason: 'missing_role'
    },
    {
      name: '@everyone role',
      integration: { ...integration, linkedRoleId: GUILD_ID, titleRoleMap: {} },
      expectedReason: 'everyone_role'
    },
    {
      name: 'managed role',
      options: { roleOverrides: { [TITLE_ROLE_ID]: { managed: true } } },
      expectedReason: 'managed_role'
    },
    {
      name: 'administrator permission',
      options: {
        roleOverrides: {
          [TITLE_ROLE_ID]: {
            permissions: new PermissionsBitField([PermissionsBitField.Flags.Administrator])
          }
        }
      },
      expectedReason: 'dangerous_role'
    },
    {
      name: 'role from another guild',
      options: {
        roleOverrides: {
          [TITLE_ROLE_ID]: { guild: { id: '999999999999999999' } }
        }
      },
      expectedReason: 'cross_guild_role'
    },
    {
      name: 'role at the bot hierarchy boundary',
      options: { roleOverrides: { [TITLE_ROLE_ID]: { position: 100, rawPosition: 100 } } },
      expectedReason: 'role_hierarchy'
    }
  ];

  for (const current of cases) {
    await t.test(current.name, async () => {
      const fixture = createMember([], current.options);
      const result = await syncWebsiteRoles({
        member: fixture.member,
        guildId: GUILD_ID,
        profile: { displayTitle: 'Observer' },
        integration: current.integration || integration
      });
      assert.deepEqual(result, { status: 'failed', reason: current.expectedReason });
      assert.deepEqual(fixture.actions, []);
    });
  }
});

test('validates every stale role before adding a safe target role', async () => {
  const fixture = createMember([STALE_ROLE_ID], {
    roleOverrides: {
      [STALE_ROLE_ID]: {
        permissions: new PermissionsBitField([PermissionsBitField.Flags.ManageWebhooks])
      }
    }
  });
  const result = await syncWebsiteRoles({
    member: fixture.member,
    guildId: GUILD_ID,
    profile: { displayTitle: 'Observer' },
    integration
  });
  assert.deepEqual(result, { status: 'failed', reason: 'dangerous_role' });
  assert.deepEqual(fixture.actions, []);
});

test('validates every configured website role before performing any write', async () => {
  const fixture = createMember([], {
    roleOverrides: {
      [STALE_ROLE_ID]: {
        permissions: new PermissionsBitField([PermissionsBitField.Flags.ManageGuild])
      }
    }
  });
  const result = await syncWebsiteRoles({
    member: fixture.member,
    guildId: GUILD_ID,
    profile: { displayTitle: 'Observer' },
    integration
  });
  assert.deepEqual(result, { status: 'failed', reason: 'dangerous_role' });
  assert.deepEqual(fixture.actions, []);
});

test('rejects an unused configured role missing from the guild before any write', async () => {
  const fixture = createMember([], { missingGuildRoleIds: [STALE_ROLE_ID] });
  const result = await syncWebsiteRoles({
    member: fixture.member,
    guildId: GUILD_ID,
    profile: { displayTitle: 'Observer' },
    integration
  });
  assert.deepEqual(result, { status: 'failed', reason: 'missing_role' });
  assert.deepEqual(fixture.actions, []);
});

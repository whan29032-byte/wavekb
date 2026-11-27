'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const linkWebsiteCommand = require('../commands/link-website');
const websiteAccountCommand = require('../commands/website-account');
const { WebsiteClientError } = require('../website-client');

function interaction(guildId = '1545731927733047306') {
  const deferred = [];
  const edits = [];
  return {
    user: { id: '111111111111111111' },
    guildId,
    member: guildId ? { id: 'member' } : null,
    async deferReply(payload) { deferred.push(payload); },
    async editReply(payload) { edits.push(payload); },
    deferred,
    edits
  };
}

test('website commands expose the two Chinese slash command names', () => {
  const linkData = linkWebsiteCommand.data.toJSON();
  const accountData = websiteAccountCommand.data.toJSON();
  assert.equal(linkData.name, '绑定网站');
  assert.equal(accountData.name, '网站账号');
  assert.equal(linkData.dm_permission, false);
  assert.equal(accountData.dm_permission, false);
});

test('website commands reject DMs and other guilds before any network request', async () => {
  for (const guildId of [null, '999999999999999999']) {
    let networkCalls = 0;
    let syncCalls = 0;

    const linkInteraction = interaction(guildId);
    await linkWebsiteCommand.execute(linkInteraction, {
      websiteGuildId: '1545731927733047306',
      websiteClient: {
        async createLink() {
          networkCalls += 1;
          return {
            linkUrl: 'https://wavekb.com/account/discord-link?token=test',
            expiresAt: '2026-11-25T08:10:00.000Z'
          };
        }
      }
    });

    const accountInteraction = interaction(guildId);
    await websiteAccountCommand.execute(accountInteraction, {
      websiteGuildId: '1545731927733047306',
      websiteClient: {
        async getMember() {
          networkCalls += 1;
          return {
            uid: 10001,
            displayName: 'No network expected',
            avatarUrl: null,
            displayTitle: null,
            nameplateStyle: 'classic',
            points: { balance: 0, lifetimeEarned: 0 }
          };
        }
      },
      async syncWebsiteRoles() { syncCalls += 1; }
    });

    assert.deepEqual(linkInteraction.deferred, [{ ephemeral: true }]);
    assert.deepEqual(accountInteraction.deferred, [{ ephemeral: true }]);
    assert.match(linkInteraction.edits[0].content, /只能.*服务器/);
    assert.match(accountInteraction.edits[0].content, /只能.*服务器/);
    assert.equal(networkCalls, 0);
    assert.equal(syncCalls, 0);
  }
});

test('link command replies privately with a ten-minute website link button', async () => {
  const current = interaction();
  const calls = [];
  await linkWebsiteCommand.execute(current, {
    websiteClient: {
      async createLink(input) {
        calls.push(input);
        return {
          linkUrl: 'https://wavekb.com/account/discord-link?token=test',
          expiresAt: '2026-11-25T08:10:00.000Z'
        };
      }
    }
  });

  assert.deepEqual(current.deferred, [{ ephemeral: true }]);
  assert.deepEqual(calls, [{
    discordUserId: '111111111111111111',
    guildId: '1545731927733047306'
  }]);
  assert.match(current.edits[0].content, /10 分钟|过期/);
  const button = current.edits[0].components[0].toJSON().components[0];
  assert.equal(button.label, '打开 WaveKB 完成绑定');
  assert.equal(button.style, 5);
  assert.equal(button.url, 'https://wavekb.com/account/discord-link?token=test');
});

test('link command distinguishes missing configuration from a temporary outage', async () => {
  const cases = [
    ['website_not_configured', /尚未配置/],
    ['website_timeout', /暂时无法连接/],
    ['website_unavailable', /暂时无法连接/]
  ];
  for (const [code, expected] of cases) {
    const current = interaction();
    await linkWebsiteCommand.execute(current, {
      websiteClient: {
        async createLink() { throw new WebsiteClientError(code); }
      }
    });
    assert.deepEqual(current.deferred, [{ ephemeral: true }]);
    assert.match(current.edits[0].content, expected);
    assert.equal(current.edits[0].components, undefined);
  }
});

test('website account command shows the allowlisted profile and role-sync result privately', async () => {
  const current = interaction();
  const profile = {
    uid: 583104,
    displayName: '悠悠',
    avatarUrl: 'https://cdn.example/avatar.png',
    displayTitle: '结构观察者',
    nameplateStyle: 'blackgold',
    points: { balance: 320, lifetimeEarned: 900 }
  };
  const syncCalls = [];
  await websiteAccountCommand.execute(current, {
    websiteClient: { async getMember() { return profile; } },
    async syncWebsiteRoles(input) {
      syncCalls.push(input);
      return { status: 'synced', addedRoleIds: ['role'], removedRoleIds: [] };
    }
  });

  assert.deepEqual(current.deferred, [{ ephemeral: true }]);
  assert.deepEqual(syncCalls, [{
    member: current.member,
    guildId: current.guildId,
    profile
  }]);
  const embed = current.edits[0].embeds[0].toJSON();
  assert.equal(embed.title, '悠悠的 WaveKB 账号');
  assert.equal(embed.thumbnail.url, 'https://cdn.example/avatar.png');
  assert.deepEqual(
    Object.fromEntries(embed.fields.map(field => [field.name, field.value])),
    {
      '网站 UID': '583104',
      '网站称号': '结构观察者',
      '铭牌': 'blackgold',
      '积分': '当前 320｜累计 900',
      'Discord 身份组': '已同步'
    }
  );
});

test('website account command authoritatively cleans configured roles for unlinked and restricted accounts', async () => {
  const cases = [
    ['not_linked', /绑定网站/],
    ['account_restricted', /受限/]
  ];
  for (const [code, expected] of cases) {
    const current = interaction();
    const syncCalls = [];
    await websiteAccountCommand.execute(current, {
      websiteClient: {
        async getMember() { throw new WebsiteClientError(code); }
      },
      async syncWebsiteRoles(input) {
        syncCalls.push(input);
        return { status: 'synced', addedRoleIds: [], removedRoleIds: ['website-role'] };
      }
    });
    assert.match(current.edits[0].content, expected);
    assert.deepEqual(syncCalls, [{
      member: current.member,
      guildId: current.guildId,
      profile: null
    }]);
  }
});

test('website account command makes no role changes for transient or invalid responses', async () => {
  const cases = [
    ['website_not_configured', /尚未配置/],
    ['website_timeout', /暂时无法连接/],
    ['website_unavailable', /暂时无法连接/],
    ['invalid_response', /暂时无法连接/]
  ];
  for (const [code, expected] of cases) {
    const current = interaction();
    let syncCalls = 0;
    await websiteAccountCommand.execute(current, {
      websiteClient: {
        async getMember() { throw new WebsiteClientError(code); }
      },
      async syncWebsiteRoles() { syncCalls += 1; }
    });
    assert.match(current.edits[0].content, expected);
    assert.equal(syncCalls, 0);
  }
});

test('website account still displays data when role synchronization fails', async () => {
  const current = interaction();
  await websiteAccountCommand.execute(current, {
    websiteClient: {
      async getMember() {
        return {
          uid: 10001,
          displayName: 'No Role',
          avatarUrl: null,
          displayTitle: null,
          nameplateStyle: 'classic',
          points: { balance: 0, lifetimeEarned: 0 }
        };
      }
    },
    async syncWebsiteRoles() { return { status: 'failed', reason: 'add_failed' }; }
  });
  const embed = current.edits[0].embeds[0].toJSON();
  const syncField = embed.fields.find(field => field.name === 'Discord 身份组');
  assert.match(syncField.value, /同步失败/);
  assert.equal(embed.fields.find(field => field.name === '网站 UID').value, '10001');
});

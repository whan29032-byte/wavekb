'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require('../config');

test('loadConfig trims values and resolves project paths', () => {
  const baseDir = path.join('C:', 'project');
  const config = loadConfig(
    {
      TOKEN: '  bot-token  ',
      CLIENT_ID: '  1545138494131666964  ',
      GUILD_ID: '  123456789  ',
      PROXY_URL: '  http://127.0.0.1:7897  ',
      DATABASE_PATH: 'storage/profile.db'
    },
    baseDir
  );

  assert.deepEqual(config, {
    token: 'bot-token',
    clientId: '1545138494131666964',
    guildId: '123456789',
    proxyUrl: 'http://127.0.0.1:7897',
    databasePath: path.resolve(baseDir, 'storage/profile.db'),
    welcomeChannelId: '1545734710888632411',
    routeRoles: null,
    growthRoles: null,
    websiteIntegration: null,
    backgroundPaths: {
      esper: path.resolve(baseDir, 'assets/bg-esper.png'),
      magician: path.resolve(baseDir, 'assets/bg-magician.png')
    }
  });
});

test('loadConfig treats a blank optional guild id as absent', () => {
  const config = loadConfig(
    { TOKEN: 'token', CLIENT_ID: 'client', GUILD_ID: '   ' },
    path.join('C:', 'project')
  );

  assert.equal(config.guildId, null);
  assert.equal(config.proxyUrl, null);
  assert.equal(config.welcomeChannelId, '1545734710888632411');
  assert.equal(config.routeRoles, null);
  assert.equal(config.growthRoles, null);
  assert.equal(config.websiteIntegration, null);
});

test('loadConfig trims a welcome channel override', () => {
  const config = loadConfig({
    TOKEN: 'token',
    CLIENT_ID: 'client',
    WELCOME_CHANNEL_ID: '  welcome-channel  '
  });

  assert.equal(config.welcomeChannelId, 'welcome-channel');
});

test('loadConfig trims a complete optional route-role configuration', () => {
  const config = loadConfig({
    TOKEN: 'token',
    CLIENT_ID: 'client',
    THEME_GUILD_ID: '  guild-theme  ',
    SCIENCE_ROLE_ID: '  role-science  ',
    MAGIC_ROLE_ID: '  role-magic  '
  });

  assert.deepEqual(config.routeRoles, {
    guildId: 'guild-theme',
    esperRoleId: 'role-science',
    magicianRoleId: 'role-magic'
  });
});

test('loadConfig rejects partial or duplicate route-role configuration without leaking the token', () => {
  const secret = 'secret-token-value';

  assert.throws(
    () => loadConfig({
      TOKEN: secret,
      CLIENT_ID: 'client',
      THEME_GUILD_ID: 'guild-theme',
      SCIENCE_ROLE_ID: 'role-science'
    }),
    error => {
      assert.match(error.message, /THEME_GUILD_ID/);
      assert.match(error.message, /SCIENCE_ROLE_ID/);
      assert.match(error.message, /MAGIC_ROLE_ID/);
      assert.equal(error.message.includes(secret), false);
      return true;
    }
  );

  assert.throws(
    () => loadConfig({
      TOKEN: secret,
      CLIENT_ID: 'client',
      THEME_GUILD_ID: 'guild-theme',
      SCIENCE_ROLE_ID: 'same-role',
      MAGIC_ROLE_ID: 'same-role'
    }),
    error => {
      assert.match(error.message, /SCIENCE_ROLE_ID/);
      assert.match(error.message, /MAGIC_ROLE_ID/);
      assert.equal(error.message.includes(secret), false);
      return true;
    }
  );
});

test('loadConfig parses exactly six distinct role ids for each growth track', () => {
  const config = loadConfig({
    TOKEN: 'token',
    CLIENT_ID: 'client',
    THEME_GUILD_ID: ' guild-theme ',
    SCIENCE_GROWTH_ROLE_IDS: ' s0, s1,s2,s3,s4,s5 ',
    MAGIC_GROWTH_ROLE_IDS: 'm0,m1,m2,m3,m4,m5'
  });

  assert.deepEqual(config.growthRoles, {
    guildId: 'guild-theme',
    esperRoleIds: ['s0', 's1', 's2', 's3', 's4', 's5'],
    magicianRoleIds: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']
  });
});

test('loadConfig rejects partial, malformed, or duplicate growth-role configuration without leaking the token', () => {
  const secret = 'secret-token-value';
  const cases = [
    {
      THEME_GUILD_ID: 'guild-theme',
      SCIENCE_GROWTH_ROLE_IDS: 's0,s1,s2,s3,s4,s5'
    },
    {
      THEME_GUILD_ID: 'guild-theme',
      SCIENCE_GROWTH_ROLE_IDS: 's0,s1,s2',
      MAGIC_GROWTH_ROLE_IDS: 'm0,m1,m2,m3,m4,m5'
    },
    {
      THEME_GUILD_ID: 'guild-theme',
      SCIENCE_GROWTH_ROLE_IDS: 'same,s1,s2,s3,s4,s5',
      MAGIC_GROWTH_ROLE_IDS: 'same,m1,m2,m3,m4,m5'
    }
  ];

  for (const entry of cases) {
    assert.throws(
      () => loadConfig({ TOKEN: secret, CLIENT_ID: 'client', ...entry }),
      error => {
        assert.match(error.message, /成长角色|GROWTH_ROLE_IDS/);
        assert.equal(error.message.includes(secret), false);
        return true;
      }
    );
  }
});

test('loadConfig rejects identity role ids that overlap growth role ids without leaking the token', () => {
  const secret = 'secret-token-value';

  assert.throws(
    () => loadConfig({
      TOKEN: secret,
      CLIENT_ID: 'client',
      THEME_GUILD_ID: 'guild-theme',
      SCIENCE_ROLE_ID: 's0',
      MAGIC_ROLE_ID: 'route-magic',
      SCIENCE_GROWTH_ROLE_IDS: 's0,s1,s2,s3,s4,s5',
      MAGIC_GROWTH_ROLE_IDS: 'm0,m1,m2,m3,m4,m5'
    }),
    error => {
      assert.match(error.message, /身份角色|成长角色|ID/);
      assert.equal(error.message.includes(secret), false);
      return true;
    }
  );
});

test('loadConfig rejects a proxy URL with an unsupported protocol', () => {
  assert.throws(
    () => loadConfig({
      TOKEN: 'token',
      CLIENT_ID: 'client',
      PROXY_URL: 'socks5://127.0.0.1:1080'
    }),
    { message: 'PROXY_URL 必须使用 http:// 或 https://' }
  );
});

test('loadConfig rejects a missing token without leaking other values', () => {
  const secretClientId = 'sensitive-client-value';

  assert.throws(
    () => loadConfig({ CLIENT_ID: secretClientId }, process.cwd()),
    error => {
      assert.equal(error.message, '缺少必需的环境变量：TOKEN');
      assert.equal(error.message.includes(secretClientId), false);
      return true;
    }
  );
});

test('loadConfig rejects a blank client id without leaking the token', () => {
  const secretToken = 'sensitive-token-value';

  assert.throws(
    () => loadConfig({ TOKEN: secretToken, CLIENT_ID: '   ' }, process.cwd()),
    error => {
      assert.equal(error.message, '缺少必需的环境变量：CLIENT_ID');
      assert.equal(error.message.includes(secretToken), false);
      return true;
    }
  );
});

test('loadConfig parses a complete website integration and title-role map', () => {
  const config = loadConfig({
    TOKEN: 'token',
    CLIENT_ID: 'client',
    WEBSITE_API_URL: ' https://wavekb.com/ ',
    WEBSITE_BOT_API_SECRET: ' integration-secret-that-is-at-least-32-bytes ',
    WEBSITE_GUILD_ID: '1545731927733047306',
    WEBSITE_LINKED_ROLE_ID: '1545731927733047307',
    WEBSITE_TITLE_ROLE_MAP: JSON.stringify({
      '结构观察者': '1545731927733047308',
      '首席研究员': '1545731927733047309'
    })
  });

  assert.deepEqual(config.websiteIntegration, {
    apiUrl: 'https://wavekb.com',
    publicUrl: 'https://wavekb.com',
    apiSecret: 'integration-secret-that-is-at-least-32-bytes',
    guildId: '1545731927733047306',
    linkedRoleId: '1545731927733047307',
    titleRoleMap: {
      '结构观察者': '1545731927733047308',
      '首席研究员': '1545731927733047309'
    }
  });
});

test('loadConfig rejects partial website integration settings without leaking secrets', () => {
  const secret = 'must-not-appear-but-is-at-least-32-bytes';
  const cases = [
    { WEBSITE_API_URL: 'https://wavekb.com', WEBSITE_BOT_API_SECRET: secret },
    { WEBSITE_BOT_API_SECRET: secret, WEBSITE_GUILD_ID: '1545731927733047306' },
    { WEBSITE_API_URL: 'https://wavekb.com', WEBSITE_GUILD_ID: '1545731927733047306' },
    { WEBSITE_LINKED_ROLE_ID: '1545731927733047307' }
  ];
  for (const entry of cases) {
    assert.throws(
      () => loadConfig({ TOKEN: 'token', CLIENT_ID: 'client', ...entry }),
      error => {
        assert.match(error.message, /WEBSITE_API_URL|WEBSITE_BOT_API_SECRET|WEBSITE_GUILD_ID/);
        assert.equal(error.message.includes(secret), false);
        return true;
      }
    );
  }
});

test('loadConfig rejects invalid website URLs, guilds, JSON and duplicate role ids', () => {
  const base = {
    TOKEN: 'token',
    CLIENT_ID: 'client',
    WEBSITE_API_URL: 'https://wavekb.com',
    WEBSITE_BOT_API_SECRET: 'website-bot-secret-that-is-at-least-32-bytes',
    WEBSITE_GUILD_ID: '1545731927733047306'
  };
  const cases = [
    { WEBSITE_API_URL: 'ftp://wavekb.com' },
    { WEBSITE_PUBLIC_URL: 'https://wavekb.com/account' },
    { WEBSITE_GUILD_ID: 'not-a-snowflake' },
    { WEBSITE_TITLE_ROLE_MAP: '{' },
    { WEBSITE_TITLE_ROLE_MAP: '[]' },
    {
      WEBSITE_LINKED_ROLE_ID: '1545731927733047307',
      WEBSITE_TITLE_ROLE_MAP: JSON.stringify({ '结构观察者': '1545731927733047307' })
    },
    {
      WEBSITE_TITLE_ROLE_MAP: JSON.stringify({
        '结构观察者': '1545731927733047308',
        '首席研究员': '1545731927733047308'
      })
    }
  ];
  for (const entry of cases) {
    assert.throws(() => loadConfig({ ...base, ...entry }), /WEBSITE_|网站/);
  }
});

test('loadConfig keeps internal API and public website origins separate', () => {
  const config = loadConfig({
    TOKEN: 'token',
    CLIENT_ID: 'client',
    WEBSITE_API_URL: 'http://wavekb-internal.test:3100',
    WEBSITE_PUBLIC_URL: 'https://wavekb.com/',
    WEBSITE_BOT_API_SECRET: 'website-bot-secret-that-is-at-least-32-bytes',
    WEBSITE_GUILD_ID: '1545731927733047306'
  });

  assert.equal(config.websiteIntegration.apiUrl, 'http://wavekb-internal.test:3100');
  assert.equal(config.websiteIntegration.publicUrl, 'https://wavekb.com');
});

test('loadConfig rejects short website secrets by UTF-8 byte length without echoing them', () => {
  for (const secret of ['short-secret', '密'.repeat(10)]) {
    assert.throws(
      () => loadConfig({
        TOKEN: 'token',
        CLIENT_ID: 'client',
        WEBSITE_API_URL: 'https://wavekb.com',
        WEBSITE_BOT_API_SECRET: secret,
        WEBSITE_GUILD_ID: '1545731927733047306'
      }),
      error => {
        assert.match(error.message, /WEBSITE_BOT_API_SECRET|32/);
        assert.equal(error.message.includes(secret), false);
        return true;
      }
    );
  }
});

test('loadConfig rejects a website linked role that overlaps a science identity role', () => {
  const conflictingRoleId = '1545731927733047307';
  assert.throws(
    () => loadConfig({
      TOKEN: 'token',
      CLIENT_ID: 'client',
      THEME_GUILD_ID: '1545731927733047306',
      SCIENCE_ROLE_ID: conflictingRoleId,
      MAGIC_ROLE_ID: '1545731927733047308',
      WEBSITE_API_URL: 'https://wavekb.com',
      WEBSITE_BOT_API_SECRET: 'website-bot-secret-that-is-at-least-32-bytes',
      WEBSITE_GUILD_ID: '1545731927733047306',
      WEBSITE_LINKED_ROLE_ID: conflictingRoleId
    }),
    /WEBSITE|网站|身份角色/
  );
});

test('loadConfig rejects a website title role that overlaps either growth track', () => {
  const conflictingRoleId = '1545731927733047319';
  assert.throws(
    () => loadConfig({
      TOKEN: 'token',
      CLIENT_ID: 'client',
      THEME_GUILD_ID: '1545731927733047306',
      SCIENCE_GROWTH_ROLE_IDS: [
        '1545731927733047311',
        '1545731927733047312',
        '1545731927733047313',
        '1545731927733047314',
        '1545731927733047315',
        '1545731927733047316'
      ].join(','),
      MAGIC_GROWTH_ROLE_IDS: [
        '1545731927733047317',
        '1545731927733047318',
        conflictingRoleId,
        '1545731927733047320',
        '1545731927733047321',
        '1545731927733047322'
      ].join(','),
      WEBSITE_API_URL: 'https://wavekb.com',
      WEBSITE_BOT_API_SECRET: 'website-bot-secret-that-is-at-least-32-bytes',
      WEBSITE_GUILD_ID: '1545731927733047306',
      WEBSITE_TITLE_ROLE_MAP: JSON.stringify({ Researcher: conflictingRoleId })
    }),
    /WEBSITE|网站|成长角色/
  );
});

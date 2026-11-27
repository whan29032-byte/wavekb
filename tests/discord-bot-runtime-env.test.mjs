import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderDiscordBotEnvironment } from '../scripts/render-discord-bot-env.mjs';

const VALID_TOKEN = `${'A'.repeat(24)}.${'B'.repeat(6)}.${'C'.repeat(38)}`;
const SQLITE_FIXTURE = Buffer.concat([
  Buffer.from('SQLite format 3\0', 'binary'),
  Buffer.alloc(84, 0),
]);
const CLI_PATH = fileURLToPath(new URL('../scripts/render-discord-bot-env.mjs', import.meta.url));

function validPayload() {
  return {
    token: VALID_TOKEN,
    clientId: '1545138494131666964',
    guildId: '1545731927733047306',
    themeGuildId: '1545731927733047306',
    scienceRoleId: '1574830047779487848',
    magicRoleId: '1574830049889353801',
    scienceGrowthRoleIds: [
      '1545732410576998431',
      '1545732479200268349',
      '1545732541049208852',
      '1545732587534819338',
      '1545732627221446766',
      '1545732685190930523',
    ],
    magicGrowthRoleIds: [
      '1574848662847357129',
      '1574848664919212125',
      '1574848667368816781',
      '1574848673534181486',
      '1574848675434463332',
      '1574848677837668532',
    ],
    websiteApiUrl: 'https://wavekb.com',
    websitePublicUrl: 'https://wavekb.com',
    websiteApiSecret: 's'.repeat(64),
    websiteGuildId: '1545731927733047306',
    databaseBase64: SQLITE_FIXTURE.toString('base64'),
  };
}

test('renders the exact allowlisted environment and a verified SQLite seed', () => {
  const rendered = renderDiscordBotEnvironment(validPayload());

  assert.equal(rendered.environmentText, [
    `TOKEN=${VALID_TOKEN}`,
    'CLIENT_ID=1545138494131666964',
    'GUILD_ID=1545731927733047306',
    'DATABASE_PATH=/var/lib/elliott-wave-discord-bot/profile-bot.db',
    'THEME_GUILD_ID=1545731927733047306',
    'SCIENCE_ROLE_ID=1574830047779487848',
    'MAGIC_ROLE_ID=1574830049889353801',
    'SCIENCE_GROWTH_ROLE_IDS=1545732410576998431,1545732479200268349,1545732541049208852,1545732587534819338,1545732627221446766,1545732685190930523',
    'MAGIC_GROWTH_ROLE_IDS=1574848662847357129,1574848664919212125,1574848667368816781,1574848673534181486,1574848675434463332,1574848677837668532',
    'WEBSITE_API_URL=https://wavekb.com',
    'WEBSITE_PUBLIC_URL=https://wavekb.com',
    `WEBSITE_BOT_API_SECRET=${'s'.repeat(64)}`,
    'WEBSITE_GUILD_ID=1545731927733047306',
    '',
  ].join('\n'));
  assert.deepEqual(rendered.databaseBuffer, SQLITE_FIXTURE);
});

test('rejects malformed credentials, Discord IDs, origins, and unexpected fields without echoing secrets', () => {
  const cases = [
    { name: 'token', change: payload => { payload.token = 'not-a-token'; } },
    { name: 'secret', change: payload => { payload.websiteApiSecret = 'too-short'; } },
    { name: 'client id', change: payload => { payload.clientId = '123'; } },
    { name: 'growth count', change: payload => { payload.magicGrowthRoleIds.pop(); } },
    { name: 'duplicate role', change: payload => { payload.magicRoleId = payload.scienceRoleId; } },
    { name: 'URL path', change: payload => { payload.websiteApiUrl = 'https://wavekb.com/private'; } },
    { name: 'HTTP URL', change: payload => { payload.websitePublicUrl = 'http://wavekb.com'; } },
    { name: 'extra field', change: payload => { payload.proxyUrl = 'http://127.0.0.1:7897'; } },
  ];

  for (const { name, change } of cases) {
    const payload = validPayload();
    change(payload);
    assert.throws(
      () => renderDiscordBotEnvironment(payload),
      error => error instanceof Error
        && error.message === 'Invalid Discord bot runtime payload.'
        && !error.message.includes(payload.token)
        && !error.message.includes(payload.websiteApiSecret),
      name,
    );
  }
});

test('accepts an omitted database seed and rejects non-SQLite or oversized base64', () => {
  const withoutSeed = validPayload();
  delete withoutSeed.databaseBase64;
  assert.equal(renderDiscordBotEnvironment(withoutSeed).databaseBuffer, null);

  for (const databaseBase64 of [
    'not base64!',
    Buffer.from('not a sqlite database').toString('base64'),
    Buffer.concat([
      Buffer.from('SQLite format 3\0', 'binary'),
      Buffer.alloc(1024 * 1024, 0),
    ]).toString('base64'),
  ]) {
    const payload = validPayload();
    payload.databaseBase64 = databaseBase64;
    assert.throws(
      () => renderDiscordBotEnvironment(payload),
      { message: 'Invalid Discord bot runtime payload.' },
    );
  }
});

test('CLI writes secret-bearing files without returning their contents', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-bot-env-'));
  const payloadPath = path.join(temporary, 'payload.json');
  const environmentPath = path.join(temporary, 'runtime.env');
  const databasePath = path.join(temporary, 'profile-bot.db');
  try {
    fs.writeFileSync(payloadPath, JSON.stringify(validPayload()));
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, payloadPath, environmentPath, databasePath],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.match(fs.readFileSync(environmentPath, 'utf8'), /^TOKEN=[^\r\n]+$/m);
    assert.deepEqual(fs.readFileSync(databasePath), SQLITE_FIXTURE);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('CLI rejects invalid JSON with one static error and no output files', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-bot-env-'));
  const payloadPath = path.join(temporary, 'payload.json');
  const environmentPath = path.join(temporary, 'runtime.env');
  const databasePath = path.join(temporary, 'profile-bot.db');
  try {
    fs.writeFileSync(payloadPath, '{"token":"must-not-leak"}');
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, payloadPath, environmentPath, databasePath],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'Invalid Discord bot runtime payload.');
    assert.equal(result.stderr.includes('must-not-leak'), false);
    assert.equal(fs.existsSync(environmentPath), false);
    assert.equal(fs.existsSync(databasePath), false);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

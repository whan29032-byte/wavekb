import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIT_PATH = path.join(ROOT, 'deployment/systemd/elliott-wave-discord-bot.service');
const TRANSACTION_PATH = path.join(ROOT, 'scripts/deploy-discord-bot-production.sh');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/deploy-discord-bot-production.yml');

function readIfPresent(filename) {
  return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
}

function unitValues(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const entries = values.get(match[1]) ?? [];
    entries.push(match[2]);
    values.set(match[1], entries);
  }
  return values;
}

test('systemd owns persistent state and restarts a sandboxed Discord bot', () => {
  const source = readIfPresent(UNIT_PATH);
  const values = unitValues(source);

  assert.equal(fs.existsSync(UNIT_PATH), true);
  assert.deepEqual(values.get('DynamicUser'), ['yes']);
  assert.deepEqual(values.get('WorkingDirectory'), ['/opt/elliott-wave-discord-bot/current']);
  assert.deepEqual(values.get('EnvironmentFile'), ['/etc/elliott-wave/discord-bot.env']);
  assert.deepEqual(values.get('ExecStart'), ['/usr/bin/node index.js']);
  assert.deepEqual(values.get('Restart'), ['always']);
  assert.deepEqual(values.get('StateDirectory'), ['elliott-wave-discord-bot']);
  assert.deepEqual(values.get('StateDirectoryMode'), ['0700']);
  assert.deepEqual(values.get('ProtectSystem'), ['strict']);
  assert.deepEqual(values.get('ProtectHome'), ['yes']);
  assert.deepEqual(values.get('PrivateTmp'), ['yes']);
  assert.deepEqual(values.get('PrivateDevices'), ['yes']);
  assert.deepEqual(values.get('NoNewPrivileges'), ['yes']);
  assert.deepEqual(values.get('RestrictAddressFamilies'), ['AF_UNIX AF_INET AF_INET6']);
  assert.deepEqual(values.get('UMask'), ['0077']);
});

test('deployment transaction seeds SQLite once and rolls every mutable release surface back on failure', () => {
  const source = readIfPresent(TRANSACTION_PATH);

  assert.equal(fs.existsSync(TRANSACTION_PATH), true);
  assert.match(source, /^set -Eeuo pipefail$/m);
  assert.match(source, /cat > "\$payload_file"/);
  assert.match(source, /\/usr\/bin\/node "\$renderer" "\$payload_file" "\$candidate_environment" "\$candidate_database"/);
  assert.match(source, /database_host_path=\/var\/lib\/private\/elliott-wave-discord-bot\/profile-bot\.db/);
  assert.match(source, /if ! sudo test -e "\$database_host_path"; then/);
  assert.match(source, /sudo install -d -m 0700 \/var\/lib\/private\/elliott-wave-discord-bot/);
  assert.match(source, /sudo install -m 0600 "\$candidate_database" "\$database_host_path"/);
  assert.doesNotMatch(source, /sudo install -d -m 0700 \/var\/lib\/elliott-wave-discord-bot/);
  assert.match(source, /rollback\(\)/);
  assert.match(source, /previous-release/);
  assert.match(source, /discord-bot\.env/);
  assert.match(source, /elliott-wave-discord-bot\.service/);
  assert.match(source, /sudo systemctl enable --now elliott-wave-discord-bot\.service/);
  assert.match(
    source,
    /if \[ "\$service_was_active" = active \]; then\s+sudo systemctl enable "\$service"\s+sudo systemctl restart "\$service"\s+else\s+sudo systemctl enable --now elliott-wave-discord-bot\.service\s+fi/
  );
  assert.match(source, /journalctl -u elliott-wave-discord-bot\.service --since "\$started_at"/);
  assert.match(source, /grep -F '已上线'/);
});

test('production workflow validates before upload and sends secrets only through SSH stdin', () => {
  const source = readIfPresent(WORKFLOW_PATH);

  assert.equal(fs.existsSync(WORKFLOW_PATH), true);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /DEPLOY_WAVEKB_DISCORD_BOT/);
  assert.match(source, /environment: production/);
  assert.match(source, /DISCORD_BOT_TOKEN: \$\{\{ secrets\.DISCORD_BOT_TOKEN \}\}/);
  assert.match(source, /DISCORD_BOT_DATABASE_BASE64: \$\{\{ secrets\.DISCORD_BOT_DATABASE_BASE64 \}\}/);
  assert.match(source, /DISCORD_BOT_API_SECRET: \$\{\{ secrets\.DISCORD_BOT_API_SECRET \}\}/);
  assert.match(source, /process\.stdout\.write\(JSON\.stringify\(payload\)\)/);
  assert.match(source, /\| ssh .*deploy-discord-bot-production/);
  assert.doesNotMatch(source, /echo "\$DISCORD_BOT_TOKEN"/);

  const validation = source.indexOf('Validate bounded secrets without output');
  const upload = source.indexOf('Upload immutable bot transaction');
  assert.ok(validation >= 0 && upload > validation);
});

test('production archive is bounded and the host identity remains pinned', () => {
  const source = readIfPresent(WORKFLOW_PATH);

  assert.match(source, /npm ci --prefix services\/discord-bot/);
  assert.match(source, /npm test --prefix services\/discord-bot/);
  assert.match(source, /npm run check --prefix services\/discord-bot/);
  for (const exclusion of ['.env', 'data', 'test-output', 'tests', 'docs', 'node_modules/.cache']) {
    assert.match(source, new RegExp(`--exclude=['"]?${exclusion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  assert.match(source, /SHA256:VDPcrNGSByDvXoaFy8GUJaqSNWS9tfyekTMi8zPXeE8/);
  assert.match(source, /StrictHostKeyChecking=yes/);
  assert.match(source, /if: always\(\)/);
});

test('deployment transaction is valid Bash', () => {
  const result = fs.existsSync(TRANSACTION_PATH)
    ? spawnSync('bash', ['-n', TRANSACTION_PATH], { encoding: 'utf8' })
    : { status: 1, stderr: 'missing transaction script' };

  assert.equal(result.status, 0, result.stderr);
});

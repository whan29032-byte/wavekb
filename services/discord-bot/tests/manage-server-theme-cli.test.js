'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeStateAtomic } = require('../scripts/manage-server-theme');

test('theme state is replaced atomically without leaving a temporary file', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-theme-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'state.json');
  fs.writeFileSync(statePath, '{"old":true}\n');

  await writeStateAtomic({ welcomeMessageId: 'message-id' }, statePath);

  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), {
    welcomeMessageId: 'message-id'
  });
  assert.deepEqual(fs.readdirSync(directory), ['state.json']);
});

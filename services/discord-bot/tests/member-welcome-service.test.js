'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDatabase } = require('../database');
const {
  deliverMemberWelcome,
  catchUpRecentMemberWelcomes,
  WELCOME_CATCH_UP_LOOKBACK_MS,
  WELCOME_CATCH_UP_LIMIT
} = require('../member-welcome-service');

function temporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youyou-welcome-'));
  const database = createDatabase(path.join(directory, 'profile.db'));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

function createGuildAndMembers(specifications, { sendFailure = null } = {}) {
  const sent = [];
  const channel = {
    isTextBased: () => true,
    async send(payload) {
      if (sendFailure?.current) throw sendFailure.current;
      const message = { id: `message-${sent.length + 1}` };
      sent.push({ memberId: payload.allowedMentions.users[0], payload, message });
      return message;
    }
  };
  const guild = {
    id: 'guild-1',
    channels: {
      async fetch(channelId) {
        assert.equal(channelId, 'welcome-channel');
        return channel;
      }
    },
    members: {
      async fetch() {
        return new Map(members.map(member => [member.id, member]));
      }
    }
  };
  const members = specifications.map(({ id, joinedTimestamp, bot = false }) => ({
    id,
    joinedTimestamp,
    user: { bot },
    guild,
    toString: () => `<@${id}>`
  }));
  return { guild, members, sent };
}

test('successful member welcome is persisted and suppresses a duplicate delivery', async t => {
  const database = temporaryDatabase(t);
  const joinedAt = 1_700_000_000_000;
  const { members, sent } = createGuildAndMembers([{ id: 'new-member', joinedTimestamp: joinedAt }]);

  const first = await deliverMemberWelcome({
    member: members[0],
    channelId: 'welcome-channel',
    database,
    now: joinedAt + 1_000
  });
  const duplicate = await deliverMemberWelcome({
    member: members[0],
    channelId: 'welcome-channel',
    database,
    now: joinedAt + 2_000
  });

  assert.equal(first.status, 'sent');
  assert.equal(duplicate.status, 'already-sent');
  assert.equal(sent.length, 1);
  assert.equal(database.hasMemberWelcome('guild-1', 'new-member', joinedAt), true);
});

test('failed member welcome remains retryable and is recorded only after Discord accepts it', async t => {
  const database = temporaryDatabase(t);
  const joinedAt = 1_700_000_000_000;
  const sendFailure = { current: new Error('Discord unavailable') };
  const { members, sent } = createGuildAndMembers(
    [{ id: 'new-member', joinedTimestamp: joinedAt }],
    { sendFailure }
  );

  await assert.rejects(deliverMemberWelcome({
    member: members[0],
    channelId: 'welcome-channel',
    database,
    now: joinedAt + 1_000
  }), /Discord unavailable/);
  assert.equal(database.hasMemberWelcome('guild-1', 'new-member', joinedAt), false);

  sendFailure.current = null;
  const retry = await deliverMemberWelcome({
    member: members[0],
    channelId: 'welcome-channel',
    database,
    now: joinedAt + 2_000
  });
  assert.equal(retry.status, 'sent');
  assert.equal(sent.length, 1);
});

test('catch-up sends recent unrecorded humans oldest first and skips bots and old joins', async t => {
  const database = temporaryDatabase(t);
  const now = 1_700_100_000_000;
  const recentOldest = now - WELCOME_CATCH_UP_LOOKBACK_MS + 1;
  const { guild, sent } = createGuildAndMembers([
    { id: 'recent-newer', joinedTimestamp: now - 1_000 },
    { id: 'old-human', joinedTimestamp: now - WELCOME_CATCH_UP_LOOKBACK_MS - 1 },
    { id: 'recent-bot', joinedTimestamp: now - 3_000, bot: true },
    { id: 'recent-oldest', joinedTimestamp: recentOldest },
    { id: 'already-sent', joinedTimestamp: now - 2_000 }
  ]);
  database.recordMemberWelcome('guild-1', 'already-sent', now - 2_000, 'existing', now - 1_500);

  const result = await catchUpRecentMemberWelcomes({
    guild,
    channelId: 'welcome-channel',
    database,
    now
  });

  assert.deepEqual(sent.map(entry => entry.memberId), ['recent-oldest', 'recent-newer']);
  assert.equal(result.sent, 2);
});

test('catch-up sends at most ten members per startup', async t => {
  const database = temporaryDatabase(t);
  const now = 1_700_100_000_000;
  const specifications = Array.from({ length: WELCOME_CATCH_UP_LIMIT + 3 }, (_, index) => ({
    id: `member-${index}`,
    joinedTimestamp: now - 20_000 + index
  }));
  const { guild, sent } = createGuildAndMembers(specifications);

  const result = await catchUpRecentMemberWelcomes({
    guild,
    channelId: 'welcome-channel',
    database,
    now
  });

  assert.equal(sent.length, WELCOME_CATCH_UP_LIMIT);
  assert.deepEqual(
    sent.map(entry => entry.memberId),
    specifications.slice(0, WELCOME_CATCH_UP_LIMIT).map(member => member.id)
  );
  assert.equal(result.sent, WELCOME_CATCH_UP_LIMIT);
});

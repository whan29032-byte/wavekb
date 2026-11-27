'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebsiteClient, WebsiteClientError } = require('../website-client');

const integration = {
  apiUrl: 'http://wavekb-internal.test:3100',
  publicUrl: 'https://wavekb.com',
  apiSecret: 'test-bot-secret-that-is-at-least-32-bytes',
  guildId: '1545731927733047306',
  linkedRoleId: null,
  titleRoleMap: {}
};

test('createLink sends an authenticated JSON request through the configured dispatcher', async () => {
  const calls = [];
  const dispatcher = { name: 'proxy-dispatcher' };
  const client = createWebsiteClient({
    integration,
    dispatcher,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return Response.json({
        linkUrl: 'https://wavekb.com/account/discord-link?token=test',
        expiresAt: '2026-11-25T08:10:00.000Z'
      });
    }
  });

  const result = await client.createLink({
    discordUserId: '111111111111111111',
    guildId: integration.guildId
  });

  assert.deepEqual(result, {
    linkUrl: 'https://wavekb.com/account/discord-link?token=test',
    expiresAt: '2026-11-25T08:10:00.000Z'
  });
  assert.equal(calls[0].url, 'http://wavekb-internal.test:3100/api/integrations/discord/link');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.dispatcher, dispatcher);
  assert.equal(
    calls[0].options.headers.authorization,
    'Bearer test-bot-secret-that-is-at-least-32-bytes'
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    discordUserId: '111111111111111111',
    guildId: integration.guildId
  });
});

test('getMember returns the validated public website profile', async () => {
  const client = createWebsiteClient({
    integration,
    async fetchImpl(url, options) {
      assert.equal(
        url,
        'http://wavekb-internal.test:3100/api/integrations/discord/member?discordUserId=111111111111111111'
      );
      assert.equal(
        options.headers.authorization,
        'Bearer test-bot-secret-that-is-at-least-32-bytes'
      );
      return Response.json({
        linked: true,
        member: {
          uid: 583104,
          displayName: '悠悠',
          avatarUrl: 'https://cdn.example/avatar.png',
          displayTitle: '结构观察者',
          nameplateStyle: 'blackgold',
          points: { balance: 320, lifetimeEarned: 900 }
        }
      });
    }
  });

  assert.deepEqual(await client.getMember('111111111111111111'), {
    uid: 583104,
    displayName: '悠悠',
    avatarUrl: 'https://cdn.example/avatar.png',
    displayTitle: '结构观察者',
    nameplateStyle: 'blackgold',
    points: { balance: 320, lifetimeEarned: 900 }
  });
});

test('getMember distinguishes unlinked and restricted website accounts', async () => {
  const cases = [
    [404, 'not_linked'],
    [403, 'account_restricted']
  ];
  for (const [status, code] of cases) {
    const client = createWebsiteClient({
      integration,
      async fetchImpl() {
        return Response.json({ error: code }, { status });
      }
    });
    await assert.rejects(
      client.getMember('111111111111111111'),
      error => error instanceof WebsiteClientError && error.code === code && error.status === status
    );
  }
});

test('successful responses with malformed JSON structures are rejected', async () => {
  const cases = [
    () => new Response('not-json', { status: 200 }),
    () => Response.json({ linked: true, member: { uid: 'wrong-type' } })
  ];
  for (const response of cases) {
    const client = createWebsiteClient({ integration, fetchImpl: async () => response() });
    await assert.rejects(
      client.getMember('111111111111111111'),
      error => error instanceof WebsiteClientError && error.code === 'invalid_response'
    );
  }
});

test('an actually hanging fetch is aborted through the supplied signal', async () => {
  const timeoutClient = createWebsiteClient({
    integration,
    timeoutMs: 20,
    fetchImpl(_url, { signal }) {
      return new Promise((resolve, reject) => {
        const watchdog = setTimeout(() => reject(new Error('abort signal was not delivered')), 200);
        signal.addEventListener('abort', () => {
          clearTimeout(watchdog);
          reject(signal.reason);
        }, { once: true });
      });
    }
  });
  await assert.rejects(
    timeoutClient.createLink({ discordUserId: '111111111111111111', guildId: integration.guildId }),
    error => {
      assert.equal(error.code, 'website_timeout');
      assert.equal(error.message.includes(integration.apiSecret), false);
      return true;
    }
  );
});

test('upstream failures use stable errors without exposing the secret', async () => {
  const failedClient = createWebsiteClient({
    integration,
    async fetchImpl() {
      return Response.json({ error: 'database_detail_that_must_not_escape' }, { status: 503 });
    }
  });
  await assert.rejects(
    failedClient.getMember('111111111111111111'),
    error => error.code === 'website_unavailable' &&
      error.message.includes('database_detail_that_must_not_escape') === false &&
      error.message.includes(integration.apiSecret) === false
  );
});

test('a disabled client reports configuration instead of making a network request', async () => {
  let calls = 0;
  const client = createWebsiteClient({
    integration: null,
    async fetchImpl() { calls += 1; }
  });
  await assert.rejects(
    client.getMember('111111111111111111'),
    error => error instanceof WebsiteClientError && error.code === 'website_not_configured'
  );
  assert.equal(calls, 0);
});

test('gameAction sends the exact idempotent action envelope and validates the result', async () => {
  const calls = [];
  const client = createWebsiteClient({
    integration,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return Response.json({
        ok: true,
        result: { action: 'skill_draw', cost: 100, balance: 900, draws: [] }
      });
    }
  });
  const input = {
    discordUserId: '111111111111111111',
    guildId: integration.guildId,
    requestId: '222222222222222222',
    action: 'skill_draw',
    payload: { path: 'esper', count: 1 }
  };
  assert.deepEqual(await client.gameAction(input), {
    action: 'skill_draw', cost: 100, balance: 900, draws: []
  });
  assert.equal(calls[0].url, 'http://wavekb-internal.test:3100/api/integrations/discord/game');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), input);
});

test('gameAction retries one uncertain transport failure with the identical idempotency envelope', async () => {
  const calls = [];
  const client = createWebsiteClient({
    integration,
    async fetchImpl(url, options) {
      calls.push({ url, body: options.body });
      if (calls.length === 1) throw new DOMException('timed out', 'TimeoutError');
      return Response.json({ ok: true, result: { action: 'pet_hatch', pets: [] } });
    }
  });
  const input = {
    discordUserId: '111111111111111111', guildId: integration.guildId,
    requestId: '222222222222222222', action: 'pet_hatch',
    payload: { eggType: 'basic', quantity: 1, path: 'esper' }
  };
  await assert.doesNotReject(client.gameAction(input));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].body, calls[1].body);
  assert.deepEqual(JSON.parse(calls[1].body), input);
});

test('gameAction retries one 5xx response with the identical idempotency envelope', async () => {
  const calls = [];
  const client = createWebsiteClient({
    integration,
    async fetchImpl(url, options) {
      calls.push({ url, body: options.body });
      if (calls.length === 1) {
        return Response.json({ error: 'integration_unavailable' }, { status: 503 });
      }
      return Response.json({ ok: true, result: { action: 'market_bet', stake: 100 } });
    }
  });
  const input = {
    discordUserId: '111111111111111111', guildId: integration.guildId,
    requestId: '222222222222222222', action: 'market_bet',
    payload: { symbol: 'academy', direction: 'up', stake: 100 }
  };
  await assert.doesNotReject(client.gameAction(input));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].body, calls[1].body);
});

test('gameAction retries one unreadable response with the identical idempotency envelope', async () => {
  const calls = [];
  const client = createWebsiteClient({
    integration,
    async fetchImpl(url, options) {
      calls.push({ url, body: options.body });
      if (calls.length === 1) {
        return new Response('{"ok":', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return Response.json({ ok: true, result: { action: 'daily_checkin', awarded: 50 } });
    }
  });
  const input = {
    discordUserId: '111111111111111111', guildId: integration.guildId,
    requestId: '222222222222222222', action: 'daily_checkin', payload: {}
  };
  await assert.doesNotReject(client.gameAction(input));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].body, calls[1].body);
});

test('gameAction preserves only allowlisted gameplay errors and rejects malformed success bodies', async () => {
  let knownCalls = 0;
  const known = createWebsiteClient({
    integration,
    fetchImpl: async () => {
      knownCalls += 1;
      return Response.json({ error: 'work_cooldown' }, { status: 429 });
    }
  });
  await assert.rejects(
    known.gameAction({
      discordUserId: '111111111111111111', guildId: integration.guildId,
      requestId: '222222222222222222', action: 'work', payload: { path: 'esper' }
    }),
    error => error instanceof WebsiteClientError && error.code === 'work_cooldown' && error.status === 429
  );
  assert.equal(knownCalls, 1);

  const malformed = createWebsiteClient({
    integration,
    fetchImpl: async () => Response.json({ ok: true, result: { action: 'market_view', secret: 'x'.repeat(40_000) } })
  });
  await assert.rejects(
    malformed.gameAction({
      discordUserId: '111111111111111111', guildId: integration.guildId,
      requestId: '222222222222222222', action: 'market_view', payload: {}
    }),
    error => error instanceof WebsiteClientError && error.code === 'invalid_response'
  );
});

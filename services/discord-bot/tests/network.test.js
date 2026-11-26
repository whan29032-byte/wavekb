'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const network = require('../network');
const { configureProxy, applyRestAgent } = network;

test('configureProxy leaves direct networking unchanged without a proxy URL', () => {
  class OriginalWebSocket {}
  const wsModule = { WebSocket: OriginalWebSocket };

  const result = configureProxy(null, { wsModule });

  assert.deepEqual(result, { restAgent: null, websocketAgent: null });
  assert.equal(wsModule.WebSocket, OriginalWebSocket);
});

test('configureProxy creates REST and WebSocket proxy agents', () => {
  class FakeRestAgent {
    constructor(url) { this.url = url; }
  }
  class FakeWebSocketAgent {
    constructor(url) { this.url = url; }
  }
  class OriginalWebSocket {
    constructor(address, protocols, options) {
      this.address = address;
      this.protocols = protocols;
      this.options = options;
    }
  }
  const wsModule = { WebSocket: OriginalWebSocket };

  const result = configureProxy('http://127.0.0.1:7897', {
    wsModule,
    RestProxyAgent: FakeRestAgent,
    WebSocketProxyAgent: FakeWebSocketAgent
  });
  const socket = new wsModule.WebSocket('wss://gateway.discord.gg', [], {
    handshakeTimeout: 10_000
  });

  assert.equal(result.restAgent.url, 'http://127.0.0.1:7897');
  assert.equal(result.websocketAgent.url, 'http://127.0.0.1:7897');
  assert.notEqual(wsModule.WebSocket, OriginalWebSocket);
  assert.equal(socket.options.handshakeTimeout, 10_000);
  assert.equal(socket.options.agent, result.websocketAgent);
});

test('applyRestAgent installs an available dispatcher only', () => {
  const installed = [];
  const rest = {
    setAgent(agent) {
      installed.push(agent);
      return this;
    }
  };
  const agent = { name: 'proxy' };

  assert.equal(applyRestAgent(rest, null), rest);
  assert.equal(applyRestAgent(rest, agent), rest);
  assert.deepEqual(installed, [agent]);
});

test('fetchImageBuffer downloads avatar bytes through the configured dispatcher', async () => {
  assert.equal(typeof network.fetchImageBuffer, 'function');
  const dispatcher = { name: 'avatar-proxy' };
  const calls = [];

  const result = await network.fetchImageBuffer(
    'https://cdn.discordapp.com/avatars/user/avatar.png',
    dispatcher,
    async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Uint8Array.from([137, 80, 78, 71]).buffer;
        }
      };
    }
  );

  assert.deepEqual(result, Buffer.from([137, 80, 78, 71]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://cdn.discordapp.com/avatars/user/avatar.png');
  assert.equal(calls[0].options.dispatcher, dispatcher);
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
});

test('fetchImageBuffer installs a bounded abort signal for stalled avatar downloads', async () => {
  let capturedSignal;

  const result = await network.fetchImageBuffer(
    'https://cdn.discordapp.com/avatar.png',
    null,
    async (url, options) => {
      capturedSignal = options.signal;
      return {
        ok: true,
        status: 200,
        async arrayBuffer() { return Uint8Array.from([1]).buffer; }
      };
    },
    5
  );

  assert.deepEqual(result, Buffer.from([1]));
  assert.equal(capturedSignal instanceof AbortSignal, true);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(capturedSignal.aborted, true);
  assert.equal(capturedSignal.reason.name, 'TimeoutError');
});

test('fetchImageBuffer cancels a non-success response body before throwing', async () => {
  let cancelCount = 0;

  await assert.rejects(
    network.fetchImageBuffer(
      'https://cdn.discordapp.com/avatar.png',
      null,
      async () => ({
        ok: false,
        status: 502,
        body: {
          async cancel() { cancelCount += 1; }
        }
      })
    ),
    /HTTP 502/
  );

  assert.equal(cancelCount, 1);
});

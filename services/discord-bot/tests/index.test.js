'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { prepareRuntime } = require('../index');

test('prepareRuntime configures networking before loading Discord runtime code', () => {
  const order = [];
  const network = { restAgent: { name: 'rest' }, websocketAgent: { name: 'ws' } };
  const botRuntime = { createBot() {}, shutdownBot() {} };

  const result = prepareRuntime(
    { proxyUrl: 'http://127.0.0.1:7897' },
    {
      networkFactory(proxyUrl) {
        order.push(`network:${proxyUrl}`);
        return network;
      },
      botLoader() {
        order.push('bot');
        return botRuntime;
      }
    }
  );

  assert.deepEqual(order, ['network:http://127.0.0.1:7897', 'bot']);
  assert.deepEqual(result, { network, ...botRuntime });
});

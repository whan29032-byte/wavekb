'use strict';

const { ProxyAgent: RestProxyAgent } = require('undici');
const { HttpsProxyAgent: WebSocketProxyAgent } = require('https-proxy-agent');
const ws = require('ws');

const ORIGINAL_WEBSOCKET = Symbol.for('youyou-profile-bot.original-websocket');

function configureProxy(proxyUrl, dependencies = {}) {
  if (!proxyUrl) {
    return { restAgent: null, websocketAgent: null };
  }

  const RestAgent = dependencies.RestProxyAgent || RestProxyAgent;
  const WebSocketAgent = dependencies.WebSocketProxyAgent || WebSocketProxyAgent;
  const wsModule = dependencies.wsModule || ws;
  const restAgent = new RestAgent(proxyUrl);
  const websocketAgent = new WebSocketAgent(proxyUrl);
  const OriginalWebSocket = wsModule[ORIGINAL_WEBSOCKET] || wsModule.WebSocket;
  wsModule[ORIGINAL_WEBSOCKET] = OriginalWebSocket;
  wsModule.WebSocket = class ProxiedWebSocket extends OriginalWebSocket {
    constructor(address, protocols, options = {}) {
      super(address, protocols, { ...options, agent: websocketAgent });
    }
  };

  return { restAgent, websocketAgent };
}

function applyRestAgent(rest, restAgent) {
  if (restAgent) rest.setAgent(restAgent);
  return rest;
}

async function fetchImageBuffer(
  url,
  dispatcher = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000
) {
  const options = { signal: AbortSignal.timeout(timeoutMs) };
  if (dispatcher) options.dispatcher = dispatcher;
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // The HTTP status remains the actionable failure if cancellation also fails.
    }
    throw new Error(`图片下载失败：HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error('图片下载失败：响应为空');
  return buffer;
}

module.exports = { configureProxy, applyRestAgent, fetchImageBuffer };

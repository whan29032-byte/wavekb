'use strict';

class WebsiteClientError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = 'WebsiteClientError';
    this.code = code;
    this.status = status;
  }
}

function validHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validMember(value) {
  return Boolean(
    value &&
    Number.isInteger(value.uid) &&
    typeof value.displayName === 'string' &&
    value.displayName &&
    (value.avatarUrl === null || validHttpUrl(value.avatarUrl)) &&
    (value.displayTitle === null || typeof value.displayTitle === 'string') &&
    typeof value.nameplateStyle === 'string' &&
    value.nameplateStyle &&
    value.points &&
    Number.isInteger(value.points.balance) &&
    Number.isInteger(value.points.lifetimeEarned)
  );
}

const gameErrorCodes = new Set([
  'not_linked',
  'account_restricted',
  'request_id_conflict',
  'insufficient_points',
  'work_cooldown',
  'work_daily_limit',
  'pet_adoption_already_used',
  'pet_egg_insufficient',
  'pet_not_found',
  'market_closed',
  'market_daily_limit'
]);

function validGameResult(value, action) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.action !== action) {
    return false;
  }
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= 32_768;
  } catch {
    return false;
  }
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new WebsiteClientError('invalid_response', response.status);
  }
}

function upstreamError(response, body) {
  const code = typeof body?.error === 'string' ? body.error : '';
  if (gameErrorCodes.has(code) && [403, 404, 409, 429].includes(response.status)) {
    return new WebsiteClientError(code, response.status);
  }
  if (response.status === 404 && code === 'not_linked') {
    return new WebsiteClientError('not_linked', 404);
  }
  if (response.status === 403 && code === 'account_restricted') {
    return new WebsiteClientError('account_restricted', 403);
  }
  if (response.status === 401) return new WebsiteClientError('website_unauthorized', 401);
  return new WebsiteClientError('website_unavailable', response.status);
}

function createWebsiteClient({
  integration,
  dispatcher = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000
}) {
  async function request(pathname, options = {}, { transportRetries = 0 } = {}) {
    if (!integration) throw new WebsiteClientError('website_not_configured');
    for (let attempt = 0; attempt <= transportRetries; attempt += 1) {
      const requestOptions = {
        ...options,
        headers: {
          authorization: `Bearer ${integration.apiSecret}`,
          ...options.headers
        },
        signal: AbortSignal.timeout(timeoutMs)
      };
      if (dispatcher) requestOptions.dispatcher = dispatcher;

      let response;
      try {
        response = await fetchImpl(new URL(pathname, integration.apiUrl).toString(), requestOptions);
      } catch (error) {
        if (attempt < transportRetries) continue;
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
          throw new WebsiteClientError('website_timeout');
        }
        throw new WebsiteClientError('website_unavailable');
      }

      let body;
      try {
        body = await responseJson(response);
      } catch (error) {
        if (attempt < transportRetries) continue;
        throw error;
      }
      if (!response.ok) {
        if (response.status >= 500 && attempt < transportRetries) continue;
        throw upstreamError(response, body);
      }
      return body;
    }
    throw new WebsiteClientError('website_unavailable');
  }

  return {
    async createLink({ discordUserId, guildId }) {
      const body = await request('/api/integrations/discord/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ discordUserId, guildId })
      });
      if (
        typeof body?.linkUrl !== 'string' ||
        !validHttpUrl(body.linkUrl) ||
        new URL(body.linkUrl).origin !== new URL(integration.publicUrl || integration.apiUrl).origin ||
        typeof body.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(body.expiresAt))
      ) {
        throw new WebsiteClientError('invalid_response');
      }
      return { linkUrl: body.linkUrl, expiresAt: body.expiresAt };
    },

    async getMember(discordUserId) {
      const query = new URLSearchParams({ discordUserId });
      const body = await request(`/api/integrations/discord/member?${query}`);
      if (body?.linked !== true || !validMember(body.member)) {
        throw new WebsiteClientError('invalid_response');
      }
      return {
        uid: body.member.uid,
        displayName: body.member.displayName,
        avatarUrl: body.member.avatarUrl,
        displayTitle: body.member.displayTitle,
        nameplateStyle: body.member.nameplateStyle,
        points: {
          balance: body.member.points.balance,
          lifetimeEarned: body.member.points.lifetimeEarned
        }
      };
    },

    async gameAction({ discordUserId, guildId, requestId, action, payload }) {
      const body = await request('/api/integrations/discord/game', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ discordUserId, guildId, requestId, action, payload })
      }, { transportRetries: 1 });
      if (body?.ok !== true || !validGameResult(body.result, action)) {
        throw new WebsiteClientError('invalid_response');
      }
      return body.result;
    }
  };
}

module.exports = { createWebsiteClient, WebsiteClientError };

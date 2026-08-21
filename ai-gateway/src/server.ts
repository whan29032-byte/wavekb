import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { UserAdministrationApi } from "./admin/user-administration.ts";
import { AuthApi } from "./auth/auth-api.ts";
import { loadConfig, type GatewayConfig } from "./config.ts";
import { SupabaseGatewayApi } from "./routes/gateway-api.ts";
import { AuthRateLimiter } from "./security/auth-rate-limit.ts";

export type ServerDeps = {
  config: GatewayConfig;
  now?: () => Date;
  api?: GatewayApi;
  authApi?: AuthRouteApi;
  userAdministrationApi?: AdminUsersApi;
  authRateLimiter?: AuthRateLimiter;
};

export type GatewayUser = { id: string; role: string };
export type GatewayApi = {
  authorize(token: string): Promise<GatewayUser | null>;
  listDirectoryResources(includeInactive?: boolean): Promise<unknown[]>;
  createDirectoryResource(
    input: Record<string, unknown>,
    actor: GatewayUser,
  ): Promise<unknown>;
  updateDirectoryResource(
    resourceId: string,
    input: Record<string, unknown>,
    actor: GatewayUser,
  ): Promise<unknown>;
  deleteDirectoryResource(
    resourceId: string,
    actor: GatewayUser,
  ): Promise<void>;
  deleteOwnPost(postId: string, actor: GatewayUser): Promise<string[]>;
  dashboard(): Promise<Record<string, unknown>>;
  listProviders(): Promise<unknown[]>;
  createProvider(input: Record<string, unknown>, actor: GatewayUser): Promise<unknown>;
  listUserConnections(ownerId: string): Promise<unknown[]>;
  createUserConnection(ownerId: string, input: Record<string, unknown>): Promise<unknown>;
  setDefaultUserConnection(ownerId: string, connectionId: string): Promise<unknown>;
  rotateUserConnectionSecret(
    ownerId: string,
    connectionId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  enqueueJob(ownerId: string, analysisId: string, input: Record<string, unknown>): Promise<unknown>;
  getJob(ownerId: string, jobId: string): Promise<unknown>;
};

export type AuthRouteApi = {
  login(identifier: string, password: string): Promise<unknown>;
  selectionState(token: string): Promise<unknown>;
  startSelection(token: string): Promise<unknown>;
  refreshSelection(token: string): Promise<unknown>;
  selectCandidate(token: string, uid: unknown): Promise<unknown>;
  completeSelection(token: string): Promise<unknown>;
};

export type AdminUsersApi = {
  summary(actor: GatewayUser): Promise<Record<string, unknown>>;
  listUsers(
    actor: GatewayUser,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  setStatus(
    actor: GatewayUser,
    targetId: unknown,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  setMute(
    actor: GatewayUser,
    targetId: unknown,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  setRole(
    actor: GatewayUser,
    targetId: unknown,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  setUid(
    actor: GatewayUser,
    targetId: unknown,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  listAudit(
    actor: GatewayUser,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
};

type InjectRequest = {
  method?: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
};
type InjectResponse = {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  json: () => unknown;
};

export type GatewayServer = {
  inject(request: InjectRequest): Promise<InjectResponse>;
  listen(options: { port: number; host: string }): Promise<void>;
  close(): Promise<void>;
};

function healthPayload(deps: ServerDeps): object {
  return {
    ok: true,
    service: "elliott-wave-ai-gateway",
    time: (deps.now ?? (() => new Date()))().toISOString(),
  };
}

function bearer(headers: Record<string, string>): string {
  return headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
}

type RouteResult = {
  statusCode: number;
  body: object;
  headers?: Record<string, string>;
};

const AUTH_HEADERS = Object.freeze({
  "cache-control": "no-store",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
});

function authResult(
  statusCode: number,
  body: object,
  headers: Record<string, string> = {},
): RouteResult {
  return {
    statusCode,
    body,
    headers: { ...AUTH_HEADERS, ...headers },
  };
}

function authFailure(error: unknown): RouteResult {
  const candidate = error as { code?: string; statusCode?: number; message?: string };
  const code = String(candidate?.code || candidate?.message || "service_unavailable");
  const allowed = new Set([
    "invalid_request",
    "invalid_credentials",
    "authentication_required",
    "email_confirmation_required",
    "uid_activation_required",
    "uid_selection_invalid",
    "uid_selection_expired",
    "uid_refresh_exhausted",
    "uid_unavailable",
    "uid_already_assigned",
    "account_banned",
    "rate_limited",
    "service_unavailable",
  ]);
  return authResult(
    Number(candidate?.statusCode || 503),
    { error: allowed.has(code) ? code : "service_unavailable" },
  );
}

function routeFailure(error: unknown): RouteResult {
  const candidate = error as { statusCode?: number; message?: string };
  const code = String(candidate?.message || "");
  const allowed = new Set([
    "ai_connection_required",
    "admin_required",
    "administration_failed",
    "user_not_found",
    "invalid_request",
    "invalid_status",
    "invalid_role",
    "invalid_uid",
    "invalid_mute_until",
    "invalid_platform",
    "invalid_resource_url",
    "invalid_avatar_url",
    "invalid_resource_name",
    "invalid_sort_order",
    "resource_not_found",
    "directory_failed",
    "invalid_post_id",
    "post_delete_failed",
    "reason_too_long",
    "cannot_ban_self",
    "cannot_mute_self",
    "cannot_change_own_role",
    "user_is_banned",
    "uid_unavailable",
  ]);
  return {
    statusCode: Number(candidate?.statusCode || 500),
    body: {
      error: allowed.has(code) ? code : "request_failed",
    },
  };
}

function authOriginAllowed(config: GatewayConfig, headers: Record<string, string>): boolean {
  const origin = String(headers.origin || "").trim().toLowerCase();
  return !origin || config.ALLOWED_WEB_ORIGINS.includes(origin);
}

function clientIp(headers: Record<string, string>): string {
  const chain = String(headers["x-forwarded-for"] || "unknown").split(",");
  return chain.at(-1)?.trim() || "unknown";
}

async function authRoute(
  deps: ServerDeps,
  method: string,
  path: string,
  headers: Record<string, string>,
  payload: unknown,
): Promise<RouteResult | null> {
  if (!path.startsWith("/api/auth/")) return null;
  if (!deps.config.AUTH_FEATURE_ENABLED || !deps.authApi) {
    return authResult(503, { error: "service_unavailable" });
  }
  if (!authOriginAllowed(deps.config, headers)) {
    return authResult(403, { error: "invalid_request" });
  }

  const input = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const limiter = deps.authRateLimiter;
  const ip = clientIp(headers);

  try {
    if (method === "POST" && path === "/api/auth/login") {
      if (!limiter) return authResult(503, { error: "service_unavailable" });
      const decision = limiter.consume(
        "auth-login-ip",
        limiter.subject(ip),
        deps.config.AUTH_LOGIN_LIMIT_PER_15_MINUTES,
        15 * 60 * 1000,
      );
      if (!decision.allowed) {
        return authResult(
          429,
          { error: "rate_limited" },
          { "retry-after": String(decision.retryAfterSeconds) },
        );
      }
      const identifier = String(input.identifier || "").trim();
      const password = String(input.password || "");
      if (!identifier || !password) {
        return authResult(400, { error: "invalid_request" });
      }
      return authResult(200, {
        session: await deps.authApi.login(identifier, password),
      });
    }

    const token = bearer(headers);
    if (!token) return authResult(401, { error: "authentication_required" });

    if (method === "GET" && path === "/api/auth/uid-selection/status") {
      return authResult(200, {
        selection: await deps.authApi.selectionState(token),
      });
    }

    if (
      method === "POST"
      && new Set([
        "/api/auth/uid-selection/start",
        "/api/auth/uid-selection/refresh",
        "/api/auth/uid-selection/select",
        "/api/auth/uid-selection/complete",
      ]).has(path)
    ) {
      if (!limiter) return authResult(503, { error: "service_unavailable" });
      const decision = limiter.consume(
        "uid-selection-ip",
        limiter.subject(ip),
        deps.config.AUTH_UID_ACTION_LIMIT_PER_HOUR,
        60 * 60 * 1000,
      );
      if (!decision.allowed) {
        return authResult(
          429,
          { error: "rate_limited" },
          { "retry-after": String(decision.retryAfterSeconds) },
        );
      }
      if (path.endsWith("/start")) {
        return authResult(200, { selection: await deps.authApi.startSelection(token) });
      }
      if (path.endsWith("/refresh")) {
        return authResult(200, { selection: await deps.authApi.refreshSelection(token) });
      }
      if (path.endsWith("/select")) {
        return authResult(200, {
          selection: await deps.authApi.selectCandidate(token, input.uid),
        });
      }
      return authResult(200, {
        selection: await deps.authApi.completeSelection(token),
      });
    }
    return authResult(404, { error: "invalid_request" });
  } catch (error) {
    return authFailure(error);
  }
}

async function actorFor(deps: ServerDeps, headers: Record<string, string>): Promise<GatewayUser | null> {
  if (!deps.api) return null;
  const token = bearer(headers);
  return token ? deps.api.authorize(token) : null;
}

async function route(
  deps: ServerDeps,
  method: string,
  target: string,
  headers: Record<string, string>,
  payload: unknown,
): Promise<RouteResult> {
  const requestUrl = new URL(target, "http://gateway.local");
  const path = requestUrl.pathname;
  const query = Object.fromEntries(requestUrl.searchParams.entries());
  if (method === "GET" && path === "/health") {
    return { statusCode: 200, body: healthPayload(deps) };
  }
  const auth = await authRoute(deps, method, path, headers, payload);
  if (auth) return auth;
  const api = deps.api;
  if (!api) return { statusCode: 503, body: { error: "gateway_not_configured" } };
  if (method === "GET" && path === "/api/directory") {
    return {
      statusCode: 200,
      body: { resources: await api.listDirectoryResources(false) },
      headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
    };
  }
  const actor = await actorFor(deps, headers);
  if (!actor) return { statusCode: 401, body: { error: "authentication_required" } };
  if (path.startsWith("/v1/admin/") && actor.role !== "admin") {
    return { statusCode: 403, body: { error: "admin_required" } };
  }
  const administration = deps.userAdministrationApi;
  if (method === "GET" && path === "/v1/admin/users/summary") {
    if (!administration) {
      return { statusCode: 503, body: { error: "administration_unavailable" } };
    }
    return { statusCode: 200, body: await administration.summary(actor) };
  }
  if (method === "GET" && path === "/v1/admin/users") {
    if (!administration) {
      return { statusCode: 503, body: { error: "administration_unavailable" } };
    }
    return { statusCode: 200, body: await administration.listUsers(actor, query) };
  }
  const userActionMatch = path.match(
    /^\/v1\/admin\/users\/([^/]+)\/(status|mute|role|uid)$/,
  );
  if (method === "POST" && userActionMatch?.[1] && userActionMatch?.[2]) {
    if (!administration) {
      return { statusCode: 503, body: { error: "administration_unavailable" } };
    }
    const targetId = decodeURIComponent(userActionMatch[1]);
    const input = (payload ?? {}) as Record<string, unknown>;
    const action = userActionMatch[2];
    const user = action === "status"
      ? await administration.setStatus(actor, targetId, input)
      : action === "mute"
      ? await administration.setMute(actor, targetId, input)
      : action === "role"
      ? await administration.setRole(actor, targetId, input)
      : await administration.setUid(actor, targetId, input);
    return { statusCode: 200, body: { user } };
  }
  if (method === "GET" && path === "/v1/admin/moderation-audit") {
    if (!administration) {
      return { statusCode: 503, body: { error: "administration_unavailable" } };
    }
    return { statusCode: 200, body: await administration.listAudit(actor, query) };
  }
  const postDeleteMatch = path.match(/^\/v1\/community\/posts\/([^/]+)\/delete$/);
  if (method === "POST" && postDeleteMatch?.[1]) {
    const storagePaths = await api.deleteOwnPost(
      decodeURIComponent(postDeleteMatch[1]),
      actor,
    );
    return { statusCode: 200, body: { deleted: true, storage_paths: storagePaths } };
  }
  if (method === "GET" && path === "/v1/admin/directory") {
    return {
      statusCode: 200,
      body: { resources: await api.listDirectoryResources(true) },
    };
  }
  if (method === "POST" && path === "/v1/admin/directory") {
    return {
      statusCode: 201,
      body: {
        resource: await api.createDirectoryResource(
          (payload ?? {}) as Record<string, unknown>,
          actor,
        ),
      },
    };
  }
  const directoryMatch = path.match(/^\/v1\/admin\/directory\/([^/]+)$/);
  if (method === "POST" && directoryMatch?.[1]) {
    return {
      statusCode: 200,
      body: {
        resource: await api.updateDirectoryResource(
          decodeURIComponent(directoryMatch[1]),
          (payload ?? {}) as Record<string, unknown>,
          actor,
        ),
      },
    };
  }
  const directoryDeleteMatch = path.match(/^\/v1\/admin\/directory\/([^/]+)\/delete$/);
  if (method === "POST" && directoryDeleteMatch?.[1]) {
    await api.deleteDirectoryResource(
      decodeURIComponent(directoryDeleteMatch[1]),
      actor,
    );
    return { statusCode: 200, body: { deleted: true } };
  }
  if (method === "GET" && path === "/v1/admin/dashboard") {
    return { statusCode: 200, body: await api.dashboard() };
  }
  if (method === "GET" && path === "/v1/admin/providers") {
    return { statusCode: 200, body: { providers: await api.listProviders() } };
  }
  if (method === "POST" && path === "/v1/admin/providers") {
    return {
      statusCode: 201,
      body: { provider: await api.createProvider((payload ?? {}) as Record<string, unknown>, actor) },
    };
  }
  if (method === "GET" && path === "/v1/user/ai-connections") {
    return {
      statusCode: 200,
      body: { connections: await api.listUserConnections(actor.id) },
    };
  }
  if (method === "POST" && path === "/v1/user/ai-connections") {
    return {
      statusCode: 201,
      body: {
        connection: await api.createUserConnection(
          actor.id,
          (payload ?? {}) as Record<string, unknown>,
        ),
      },
    };
  }
  const defaultConnectionMatch = path.match(/^\/v1\/user\/ai-connections\/([^/]+)\/default$/);
  if (method === "POST" && defaultConnectionMatch?.[1]) {
    return {
      statusCode: 200,
      body: {
        connection: await api.setDefaultUserConnection(
          actor.id,
          decodeURIComponent(defaultConnectionMatch[1]),
        ),
      },
    };
  }
  const rotateConnectionMatch = path.match(/^\/v1\/user\/ai-connections\/([^/]+)\/rotate-key$/);
  if (method === "POST" && rotateConnectionMatch?.[1]) {
    return {
      statusCode: 200,
      body: {
        connection: await api.rotateUserConnectionSecret(
          actor.id,
          decodeURIComponent(rotateConnectionMatch[1]),
          (payload ?? {}) as Record<string, unknown>,
        ),
      },
    };
  }
  const runMatch = path.match(/^\/v1\/analyses\/([^/]+)\/ai-run$/);
  if (method === "POST" && runMatch?.[1]) {
    return {
      statusCode: 202,
      body: {
        job: await api.enqueueJob(
          actor.id,
          decodeURIComponent(runMatch[1]),
          (payload ?? {}) as Record<string, unknown>,
        ),
      },
    };
  }
  const jobMatch = path.match(/^\/v1\/jobs\/([^/]+)$/);
  if (method === "GET" && jobMatch?.[1]) {
    return {
      statusCode: 200,
      body: { job: await api.getJob(actor.id, decodeURIComponent(jobMatch[1])) },
    };
  }
  return { statusCode: 404, body: { error: "not_found" } };
}

export function buildServer(deps: ServerDeps): GatewayServer {
  let active: ReturnType<typeof createServer> | null = null;
  const runtimeDeps: ServerDeps = {
    ...deps,
    authRateLimiter: deps.authRateLimiter
      ?? new AuthRateLimiter(deps.config.AI_SECRET_MASTER_KEY),
  };
  return {
    async inject(request) {
      let result;
      try {
        result = await route(
          runtimeDeps,
          request.method ?? "GET",
          request.url,
          request.headers ?? {},
          request.payload,
        );
      } catch (error) {
        result = routeFailure(error);
      }
      const body = JSON.stringify(result.body);
      return {
        statusCode: result.statusCode,
        body,
        headers: result.headers ?? {},
        json: () => JSON.parse(body),
      };
    },
    async listen(options) {
      active = createServer(async (request: IncomingMessage, response: ServerResponse) => {
        const origin = String(request.headers.origin ?? "");
        if (runtimeDeps.config.ALLOWED_WEB_ORIGINS.includes(origin.toLowerCase())) {
          response.setHeader("access-control-allow-origin", origin);
          response.setHeader("vary", "origin");
        }
        response.setHeader("access-control-allow-headers", "authorization, content-type");
        response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.end();
          return;
        }
        let raw = "";
        try {
          for await (const chunk of request) {
            raw += chunk;
            const requestLimit = String(request.url || "").startsWith("/api/auth/")
              ? 64 * 1024
              : runtimeDeps.config.AI_MAX_IMAGE_BYTES + 1024 * 1024;
            if (Buffer.byteLength(raw) > requestLimit) {
              throw Object.assign(new Error("request too large"), { statusCode: 413 });
            }
          }
          const payload = raw ? JSON.parse(raw) : undefined;
          const headers = Object.fromEntries(
            Object.entries(request.headers).map(([key, value]) => [key, String(value ?? "")]),
          );
          const result = await route(
            runtimeDeps,
            request.method ?? "GET",
            request.url ?? "/",
            headers,
            payload,
          );
          response.statusCode = result.statusCode;
          response.setHeader("content-type", "application/json; charset=utf-8");
          for (const [key, value] of Object.entries(result.headers ?? {})) {
            response.setHeader(key, value);
          }
          response.end(JSON.stringify(result.body));
        } catch (error) {
          const failure = routeFailure(error);
          response.statusCode = failure.statusCode;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(JSON.stringify(failure.body));
        }
      });
      await new Promise<void>((resolve, reject) => {
        active?.once("error", reject);
        active?.listen(options.port, options.host, resolve);
      });
    },
    async close() {
      if (!active) return;
      await new Promise<void>((resolve, reject) => {
        active?.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isMain) {
  const config = loadConfig(process.env);
  const server = buildServer({
    config,
    api: new SupabaseGatewayApi(config),
    authApi: new AuthApi(config),
    userAdministrationApi: new UserAdministrationApi(config),
  });
  await server.listen({ port: config.PORT, host: "127.0.0.1" });
}

import assert from "node:assert/strict";
import test from "node:test";
import { AuthApi } from "../src/auth/auth-api.ts";
import { loadConfig } from "../src/config.ts";

const config = loadConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com/",
});

function response(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("UID login resolves email internally and never returns it", async () => {
  const calls: Array<{ url: string; body: any; authorization: string }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({
      url,
      body,
      authorization: String(new Headers(init?.headers).get("authorization") || ""),
    });
    if (url.includes("/rest/v1/profiles?public_uid=")) {
      return response(200, [{ id: "user-1" }]);
    }
    if (url.includes("/auth/v1/admin/users/user-1")) {
      return response(200, { id: "user-1", email: "owner@example.com" });
    }
    if (url.includes("/auth/v1/token?grant_type=password")) {
      return response(200, {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "user-1" },
      });
    }
    if (url.includes("/rest/v1/profiles?id=eq.user-1")) {
      return response(200, [{
        id: "user-1",
        public_uid: 583104,
        display_name: "Wave",
        role: "user",
      }]);
    }
    return response(404, {});
  };

  const api = new AuthApi(config, fakeFetch as typeof fetch);
  const result = await api.login("583104", "correct horse battery staple");

  assert.equal(result.access_token, "access");
  assert.equal(JSON.stringify(result).includes("owner@example.com"), false);
  const passwordCall = calls.find((call) => call.url.includes("grant_type=password"));
  assert.equal(passwordCall?.body.email, "owner@example.com");
  assert.equal(passwordCall?.authorization, "");
});

test("missing UID and wrong password return the same public error", async () => {
  const missingUid = new AuthApi(
    config,
    (async () => response(200, [])) as typeof fetch,
  );
  await assert.rejects(
    () => missingUid.login("583104", "wrong"),
    /invalid_credentials/,
  );

  const wrongPasswordFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/rest/v1/profiles")) return response(200, [{ id: "user-1" }]);
    if (url.includes("/auth/v1/admin/users/user-1")) {
      return response(200, { id: "user-1", email: "owner@example.com" });
    }
    return response(400, { error: "invalid_grant", error_description: "bad password" });
  };
  const wrongPassword = new AuthApi(config, wrongPasswordFetch as typeof fetch);
  await assert.rejects(
    () => wrongPassword.login("583104", "wrong"),
    /invalid_credentials/,
  );
});

test("unconfirmed JWT cannot start UID selection", async () => {
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return response(200, { id: "user-1", email_confirmed_at: null });
    }
    return response(404, {});
  };
  const api = new AuthApi(config, fakeFetch as typeof fetch);
  await assert.rejects(
    () => api.startSelection("unconfirmed-jwt"),
    /email_confirmation_required/,
  );
});

test("confirmed JWT reads UID selection state without starting a session", async () => {
  const calls: string[] = [];
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/auth/v1/user")) {
      return response(200, {
        id: "user-1",
        email_confirmed_at: "2026-07-26T04:17:25Z",
      });
    }
    if (url.includes("/rest/v1/rpc/get_uid_selection_state")) {
      return response(200, {
        candidate_uids: [583104],
        selected_uid: 583104,
        refreshes_used: 0,
        refreshes_remaining: 3,
        expires_at: "2026-07-26T05:00:00Z",
        status: "pending",
        public_uid: null,
      });
    }
    return response(404, {});
  };
  const api = new AuthApi(config, fakeFetch as typeof fetch);
  const state = await api.selectionState("confirmed-jwt");

  assert.deepEqual(state.candidateUids, [583104]);
  assert.equal(calls.some((url) => url.includes("start_uid_selection")), false);
});

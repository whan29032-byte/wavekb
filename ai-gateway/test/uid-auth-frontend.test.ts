import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const core = require("../../community/community-core.js");
const { createAuthController } = require(
  "../../community/community-auth.js",
);
const { postCardModel } = require(
  "../../community/community-ui.js",
);

function fakeClient() {
  const calls: any[] = [];
  const client = {
    calls,
    from(table: string) {
      return {
        select(columns: string) {
          calls.push({ kind: "select", table, columns });
          return {
            eq() {
              return {
                async single() {
                  return {
                    data: {
                      id: "user-1",
                      public_uid: null,
                      display_name: "Wave",
                      role: "user",
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
    auth: {
      async getSession() {
        return { data: { session: null }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async setSession(tokens: any) {
        calls.push({ kind: "setSession", tokens });
        return {
          data: {
            session: {
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              user: {
                id: "user-1",
                email_confirmed_at: "2026-07-26T00:00:00Z",
              },
            },
          },
          error: null,
        };
      },
      async signInWithOtp(value: any) {
        calls.push({ kind: "signInWithOtp", value });
        return { data: { user: null, session: null }, error: null };
      },
      async verifyOtp(value: any) {
        calls.push({ kind: "verifyOtp", value });
        return {
          data: {
            user: { id: "user-1", email: value.email },
            session: {
              access_token: "otp-access",
              refresh_token: "otp-refresh",
              user: {
                id: "user-1",
                email: value.email,
                email_confirmed_at: "2026-07-26T00:00:00Z",
              },
            },
          },
          error: null,
        };
      },
      async updateUser(value: any) {
        calls.push({ kind: "updateUser", value });
        return { data: { user: { id: "user-1" } }, error: null };
      },
      async signOut() {
        calls.push({ kind: "signOut" });
        return { error: null };
      },
    },
  };
  return client;
}

test("registration requires a matching password confirmation", () => {
  const mismatch = core.validateRegistration({
    displayName: "Wave",
    email: "wave@example.com",
    verificationCode: "123456",
    password: "correct horse battery staple",
    confirmPassword: "different password",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.fields.confirmPassword, "两次输入的密码不一致。");
});

test("registration reports the concrete invalid fields instead of a generic prompt", async () => {
  const auth = createAuthController({
    client: fakeClient(),
    authGatewayUrl: "/api/auth",
  });

  await assert.rejects(
    auth.completeRegistration({
      verificationCode: "123456",
      displayName: "A",
      email: "wave@example.com",
      password: "123456789",
      confirmPassword: "123456789",
    }),
    (error: any) => {
      assert.equal(
        error.message,
        "昵称需要 2—32 个字符。 密码至少需要 10 个字符。",
      );
      assert.deepEqual(error.fields, {
        displayName: "昵称需要 2—32 个字符。",
        password: "密码至少需要 10 个字符。",
      });
      return true;
    },
  );
});

test("registration requests a six digit email OTP with nickname metadata", async () => {
  const client = fakeClient();
  const auth = createAuthController({
    client,
    authGatewayUrl: "/api/auth",
  });

  await auth.requestRegistrationCode({
    displayName: "Wave",
    email: "wave@example.com",
  });

  const request = client.calls.find((call: any) => call.kind === "signInWithOtp");
  assert.deepEqual(request.value, {
    email: "wave@example.com",
    options: {
      shouldCreateUser: true,
      data: { display_name: "Wave" },
    },
  });
});

test("registration verifies the OTP before setting the password", async () => {
  const client = fakeClient();
  const auth = createAuthController({
    client,
    authGatewayUrl: "/api/auth",
  });

  await auth.completeRegistration({
    displayName: "Wave",
    email: "wave@example.com",
    verificationCode: "123456",
    password: "correct horse battery staple",
    confirmPassword: "correct horse battery staple",
  });

  const verification = client.calls.find((call: any) => call.kind === "verifyOtp");
  const password = client.calls.find((call: any) => call.kind === "updateUser");
  assert.deepEqual(verification.value, {
    email: "wave@example.com",
    token: "123456",
    type: "email",
  });
  assert.deepEqual(password.value, {
    password: "correct horse battery staple",
    data: { display_name: "Wave" },
  });
  assert.equal(
    client.calls.findIndex((call: any) => call.kind === "verifyOtp")
      < client.calls.findIndex((call: any) => call.kind === "updateUser"),
    true,
  );
});

test("login accepts UID through the backend and installs the returned session", async () => {
  const client = fakeClient();
  const requests: any[] = [];
  const auth = createAuthController({
    client,
    authGatewayUrl: "/api/auth",
    fetchImpl: async (url: string, init: RequestInit) => {
      requests.push({ url, init, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({
        session: {
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: "user-1",
            public_uid: 583104,
            display_name: "Wave",
            role: "user",
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await auth.login({ identifier: "583104", password: "secret" });

  assert.equal(requests[0].url, "/api/auth/login");
  assert.deepEqual(requests[0].body, {
    identifier: "583104",
    password: "secret",
  });
  assert.equal(
    client.calls.some((call: any) => call.kind === "setSession"),
    true,
  );
  assert.equal(
    client.calls.some((call: any) => (
      call.kind === "select" && call.columns.includes("public_uid")
    )),
    true,
  );
});

test("UID selection actions use the confirmed session bearer token", async () => {
  const client = fakeClient();
  const requests: any[] = [];
  const auth = createAuthController({
    client,
    authGatewayUrl: "/api/auth",
    fetchImpl: async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("/login")) {
        return new Response(JSON.stringify({
          session: {
            access_token: "access",
            refresh_token: "refresh",
            expires_in: 3600,
            token_type: "bearer",
            user: { id: "user-1" },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        selection: {
          candidateUids: [583104],
          selectedUid: 583104,
          refreshesUsed: 0,
          refreshesRemaining: 3,
          expiresAt: "2026-07-26T05:00:00Z",
          status: "pending",
          publicUid: null,
        },
      }), { status: 200 });
    },
  });
  await auth.login({ identifier: "wave@example.com", password: "secret" });

  await auth.startUidSelection();
  await auth.refreshUidSelection();
  await auth.selectUid(583104);
  await auth.completeUidSelection();

  const protectedCalls = requests.slice(1);
  assert.deepEqual(
    protectedCalls.map((call) => call.url),
    [
      "/api/auth/uid-selection/start",
      "/api/auth/uid-selection/refresh",
      "/api/auth/uid-selection/select",
      "/api/auth/uid-selection/complete",
    ],
  );
  assert.equal(
    protectedCalls.every((call) => (
      new Headers(call.init.headers).get("authorization") === "Bearer access"
    )),
    true,
  );
});

test("frontend presents UID activation without generating UIDs in the browser", async () => {
  const root = new URL("../../community/", import.meta.url);
  const [ui, auth, config] = await Promise.all([
    readFile(new URL("community-ui.js", root), "utf8"),
    readFile(new URL("community-auth.js", root), "utf8"),
    readFile(new URL("config.js", root), "utf8"),
  ]);

  assert.match(ui, /邮箱或 UID/);
  assert.match(ui, /确认密码/);
  assert.match(ui, /获取验证码/);
  assert.match(ui, /6 位验证码/);
  assert.match(ui, /选择你的 UID/);
  assert.match(ui, /刷新 UID/);
  assert.doesNotMatch(ui, /重发验证邮件/);
  assert.match(config, /authGatewayUrl:\s*"\/api\/auth"/);
  assert.doesNotMatch(auth, /Math\.random|crypto\.getRandomValues/);
});

test("public posts expose the author's public UID without exposing email", async () => {
  const root = new URL("../../community/", import.meta.url);
  const repository = await readFile(new URL("community-repository.js", root), "utf8");
  const model = postCardModel({
    id: "post-1",
    title: "Wave count",
    body: "A sufficiently long post body for a public card.",
    created_at: "2026-07-26T00:00:00Z",
    profiles: {
      display_name: "Wave",
      public_uid: 583104,
    },
    post_images: [],
  });

  assert.equal(model.publicUid, 583104);
  assert.match(repository, /public_uid/);
  assert.doesNotMatch(repository, /profiles![^(]*\([^)]*\bemail\b/);
});

test("published HTML cache-busts the UID authentication assets", async () => {
  const root = new URL("../../", import.meta.url);
  const pages = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("elliott-wave-preview.html", root), "utf8"),
    readFile(new URL("elliott-wave-knowledge-tree.html", root), "utf8"),
  ]);

  for (const page of pages) {
    assert.match(page, /community\/community\.css\?v=[A-Za-z0-9._-]+/);
    assert.match(page, /community\/config\.js\?v=[A-Za-z0-9._-]+/);
    assert.match(page, /community\/community-core\.js\?v=[A-Za-z0-9._-]+/);
    assert.match(page, /community\/community-repository\.js\?v=[A-Za-z0-9._-]+/);
    assert.match(page, /community\/community-auth\.js\?v=[A-Za-z0-9._-]+/);
    assert.match(page, /community\/community-ui\.js\?v=[A-Za-z0-9._-]+/);
  }
});

test("the public root HTML is never served from a stale browser cache", async () => {
  const nginx = await readFile(
    new URL("../../deployment/nginx-elliott-wave.conf", import.meta.url),
    "utf8",
  );
  const rootLocation = nginx.match(/location = \/ \{([\s\S]*?)\n    \}/)?.[1] || "";

  assert.match(rootLocation, /try_files \/index\.html =404;/);
  assert.match(rootLocation, /Cache-Control "no-cache"/);
});

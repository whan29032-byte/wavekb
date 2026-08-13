import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const {createAuthController} = require(
  fileURLToPath(new URL("../community/community-auth.js", import.meta.url))
);
const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

function mockClient({profileError = null} = {}) {
  let authHandler = null;
  const session = {user: {id: "user-1", email: "reader@example.com"}};
  return {
    session,
    emit(event) {
      authHandler(event, session);
    },
    auth: {
      onAuthStateChange(handler) {
        authHandler = handler;
        return {data: {subscription: {unsubscribe() {}}}};
      },
      async getSession() {
        return {data: {session}, error: null};
      },
      async resetPasswordForEmail(email, options) {
        return {data: {email, options}, error: null};
      }
    },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async single() {
          if (profileError) return {data: null, error: profileError};
          return {
            data: {
              id: "user-1",
              public_uid: 33333,
              display_name: "测试用户",
              role: "member",
              nameplate_style: "classic"
            },
            error: null
          };
        }
      };
    }
  };
}

test("recovery URL opens the reset form before profile loading can fail", async () => {
  const client = mockClient({profileError: new Error("profile unavailable")});
  let recoveryCount = 0;
  const controller = createAuthController({
    client,
    locationLike: {
      origin: "https://wavekb.com",
      pathname: "/",
      search: "?auth=recovery",
      hash: "#access_token=token&type=recovery"
    },
    onPasswordRecovery() { recoveryCount += 1; }
  });
  await controller.start();
  assert.equal(recoveryCount, 1);
  assert.equal(controller.session(), client.session);
});

test("PASSWORD_RECOVERY event opens the reset form before profile lookup", async () => {
  const client = mockClient({profileError: new Error("profile unavailable")});
  let recoveryCount = 0;
  const controller = createAuthController({
    client,
    locationLike: {
      origin: "https://wavekb.com",
      pathname: "/",
      search: "",
      hash: ""
    },
    onPasswordRecovery() { recoveryCount += 1; }
  });
  await controller.start();
  client.emit("PASSWORD_RECOVERY");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(recoveryCount, 1);
});

test("password recovery redirect remains on the production origin and carries a marker", async () => {
  const client = mockClient();
  const controller = createAuthController({
    client,
    locationLike: {
      origin: "https://wavekb.com",
      pathname: "/",
      search: "",
      hash: ""
    }
  });
  const result = await controller.resetPassword(" reader@example.com ");
  assert.equal(result.email, "reader@example.com");
  assert.equal(result.options.redirectTo, "https://wavekb.com/?auth=recovery");
});

test("frontend maps mail-provider recovery failures to an actionable message", async () => {
  const ui = await read("community/community-ui.js");
  assert.match(ui, /unexpected_failure\|error sending recovery email\|could not send email/);
  assert.match(ui, /重置邮件暂时无法发送/);
});

test("both entry documents cache-bust the hardened recovery scripts", async () => {
  const documents = await Promise.all([
    read("index.html"),
    read("elliott-wave-preview.html")
  ]);
  for (const html of documents) {
    assert.match(html, /community-auth\.js\?v=wavekb-password-recovery-20260812-1/);
    assert.match(html, /community-ui\.js\?v=wavekb-password-recovery-20260812-1/);
  }
});

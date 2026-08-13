import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";

const config = loadConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
  AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  AUTH_SITE_URL: "https://knowledge.example.com/",
});

const api = {
  async authorize(token: string) {
    if (token === "admin-token") return { id: "admin-1", role: "admin" };
    if (token === "user-token") return { id: "user-1", role: "user" };
    return null;
  },
  async listDirectoryResources(includeInactive = false) {
    return [{
      id: "r1",
      platform: "x",
      name: "Wave Research",
      url: "https://x.com/waveresearch",
      avatar_url: "https://unavatar.io/x/waveresearch",
      active: includeInactive ? false : true,
      sort_order: 10,
    }];
  },
  async createDirectoryResource(input: any) {
    return { id: "r2", ...input, avatar_url: "https://unavatar.io/x/newwave" };
  },
  async updateDirectoryResource(resourceId: string, input: any) {
    return { id: resourceId, ...input };
  },
  async deleteDirectoryResource() {},
  async dashboard() {
    return { calls_today: 2, tokens_today: 90, cost_today: 0.01 };
  },
  async listProviders() {
    return [{ id: "p1", name: "Mock", adapter: "openai_compatible", last_four: "1234" }];
  },
  async createProvider() {
    return { id: "p2", name: "New", adapter: "openai_compatible", last_four: "5678" };
  },
  async listUserConnections(ownerId: string) {
    return [{
      id: "c1",
      owner_id: ownerId,
      label: "我的模型",
      model_name: "model-a",
      secret_mask: "••••1234",
      is_default: true,
    }];
  },
  async createUserConnection(ownerId: string) {
    return {
      id: "c2",
      owner_id: ownerId,
      label: "新接口",
      secret_mask: "••••5678",
      is_default: false,
    };
  },
  async setDefaultUserConnection(ownerId: string, connectionId: string) {
    return { id: connectionId, owner_id: ownerId, is_default: true, secret_mask: "••••1234" };
  },
  async rotateUserConnectionSecret(ownerId: string, connectionId: string) {
    return { id: connectionId, owner_id: ownerId, secret_mask: "••••9999", key_version: 2 };
  },
  async enqueueJob(ownerId: string, analysisId: string) {
    return { id: "j1", owner_id: ownerId, analysis_id: analysisId, status: "queued" };
  },
  async getJob(_ownerId: string, jobId: string) {
    return { id: jobId, status: "queued" };
  },
};

const userAdministrationApi = {
  async summary() {
    return {
      total_users: 12,
      banned_users: 1,
      muted_users: 2,
      admin_users: 2,
    };
  },
  async listUsers(_actor: any, input: any) {
    return {
      users: [{
        id: "62a6d9fa-f705-4e6e-9aa4-6bfcb13a4ce0",
        public_uid: 583104,
        display_name: "Wave",
      }],
      page: Number(input.page || 1),
      limit: 25,
      total: 1,
    };
  },
  async setStatus(_actor: any, targetId: unknown, input: any) {
    return { id: targetId, account_status: input.status };
  },
  async setMute(_actor: any, targetId: unknown, input: any) {
    return { id: targetId, muted_until: input.muted_until };
  },
  async setRole(_actor: any, targetId: unknown, input: any) {
    return { id: targetId, role: input.role };
  },
  async setUid(_actor: any, targetId: unknown, input: any) {
    return { id: targetId, public_uid: input.uid };
  },
  async listAudit() {
    return { entries: [{ action: "ban", target_uid: 583104 }], page: 1, limit: 50 };
  },
};

test("admin routes require both a valid token and admin role", async () => {
  const server = buildServer({ config, api });
  assert.equal((await server.inject({ url: "/v1/admin/providers" })).statusCode, 401);
  assert.equal((await server.inject({
    url: "/v1/admin/providers",
    headers: { authorization: "Bearer user-token" },
  })).statusCode, 403);
  const response = await server.inject({
    url: "/v1/admin/providers",
    headers: { authorization: "Bearer admin-token" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes("api_key"), false);
});

test("external directory is public to read and admin-only to manage", async () => {
  const server = buildServer({ config, api });
  const publicList = await server.inject({ url: "/api/directory" });
  assert.equal(publicList.statusCode, 200);
  assert.equal((publicList.json() as any).resources[0].name, "Wave Research");

  const rejected = await server.inject({
    method: "POST",
    url: "/v1/admin/directory",
    headers: { authorization: "Bearer user-token" },
    payload: { platform: "x", url: "https://x.com/newwave" },
  });
  assert.equal(rejected.statusCode, 403);

  const created = await server.inject({
    method: "POST",
    url: "/v1/admin/directory",
    headers: { authorization: "Bearer admin-token" },
    payload: {
      platform: "x",
      name: "New Wave",
      url: "https://x.com/newwave",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal((created.json() as any).resource.name, "New Wave");
});

test("ordinary user can enqueue only through the site gateway", async () => {
  const server = buildServer({ config, api });
  const response = await server.inject({
    method: "POST",
    url: "/v1/analyses/a1/ai-run",
    headers: { authorization: "Bearer user-token" },
    payload: { task_type: "wave_analysis" },
  });
  assert.equal(response.statusCode, 202);
  assert.equal((response.json() as any).job.status, "queued");
  assert.equal(response.body.includes("moonshot"), false);
});

test("users can manage only their own masked AI connections", async () => {
  const server = buildServer({ config, api });
  const list = await server.inject({
    url: "/v1/user/ai-connections",
    headers: { authorization: "Bearer user-token" },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.includes("••••1234"), true);
  assert.equal(list.body.includes("api_key"), false);

  const created = await server.inject({
    method: "POST",
    url: "/v1/user/ai-connections",
    headers: { authorization: "Bearer user-token" },
    payload: {
      label: "新接口",
      adapter: "openai_compatible",
      base_url: "https://api.example.com/v1",
      model_name: "model-a",
      api_key: "secret-value-5678",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.includes("secret-value-5678"), false);
  assert.equal(created.body.includes("••••5678"), true);
});

test("user administration is isolated behind admin routes", async () => {
  const server = buildServer({ config, api, userAdministrationApi });
  const userList = await server.inject({
    url: "/v1/admin/users?query=583104&page=1",
    headers: { authorization: "Bearer user-token" },
  });
  assert.equal(userList.statusCode, 403);

  const adminList = await server.inject({
    url: "/v1/admin/users?query=583104&page=1",
    headers: { authorization: "Bearer admin-token" },
  });
  assert.equal(adminList.statusCode, 200);
  assert.equal((adminList.json() as any).users[0].public_uid, 583104);

  const changed = await server.inject({
    method: "POST",
    url: "/v1/admin/users/62a6d9fa-f705-4e6e-9aa4-6bfcb13a4ce0/status",
    headers: { authorization: "Bearer admin-token" },
    payload: { status: "banned", reason: "spam" },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal((changed.json() as any).user.account_status, "banned");

  const audit = await server.inject({
    url: "/v1/admin/moderation-audit",
    headers: { authorization: "Bearer admin-token" },
  });
  assert.equal(audit.statusCode, 200);
  assert.equal((audit.json() as any).entries[0].action, "ban");
});

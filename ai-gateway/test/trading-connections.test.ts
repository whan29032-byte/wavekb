import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProviderAccount,
  ProviderCapabilities,
  ProviderCredentialInput,
  TradingProviderAdapter,
  ValidatedAccount,
} from "../src/trading/providers/contracts.ts";
import {
  ExchangeConnectionService,
  type ConnectionRecord,
  type TradingConnectionStore,
} from "../src/trading/connection-service.ts";
import { loadConfig } from "../src/config.ts";
import { buildServer } from "../src/server.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const otherOwner = "22222222-2222-4222-8222-222222222222";

const capabilities: ProviderCapabilities = {
  products: ["usdt_perpetual"], history_age_days: 90, history_range_days: 7,
  page_size: 100, pagination: "time", position_grouping: "net_zero_cycle",
  has_position_id: false, has_realized_pnl: true, has_fee_asset: true,
  has_funding_or_swap: true, has_external_cash_flow: true, has_usd_valuation: true,
  account_currency: "USDT", settlement_assets: ["USDT"], valuation_pairs: [],
};

class Adapter implements TradingProviderAdapter {
  readonly provider: "binance" | "exness";
  readonly accounts: ValidatedAccount[];
  lastInput: ProviderCredentialInput | null = null;

  constructor(provider: "binance" | "exness", accounts: ValidatedAccount[]) {
    this.provider = provider;
    this.accounts = accounts;
  }

  async validateCredentials(input: ProviderCredentialInput) {
    this.lastInput = input;
    if (!input.read_only_ack) throw Object.assign(new Error("read_only_ack_required"), { statusCode: 400 });
    return this.accounts;
  }
  async discoverCapabilities(account: ProviderAccount) {
    return { ...capabilities, products: this.accounts.find((item) => item.external_account_id === account.external_account_id)?.products ?? capabilities.products };
  }
  async fetchAccountSnapshot(): Promise<never> { throw new Error("not_used"); }
  async fetchHistory(): Promise<never> { throw new Error("not_used"); }
  normalizeHistory(): never { throw new Error("not_used"); }
}

class Store implements TradingConnectionStore {
  connections: ConnectionRecord[] = [];
  credentials = new Map<string, { owner_id: string; provider: string; envelope: string; mask: string }>();
  credentialSequence = 0;

  async list(ownerId: string) { return this.connections.filter((item) => item.owner_id === ownerId); }
  async get(ownerId: string, id: string) { return this.connections.find((item) => item.owner_id === ownerId && item.id === id) ?? null; }
  async listByCredentialSet(ownerId: string, credentialSetId: string) {
    return this.connections.filter((item) => item.owner_id === ownerId && item.credential_set_id === credentialSetId);
  }
  async createCredentialSet(input: { owner_id: string; provider: string; label: string; secret_mask: string; encrypted: { ciphertext: string } }) {
    const id = `credential-${++this.credentialSequence}`;
    this.credentials.set(id, { owner_id: input.owner_id, provider: input.provider, envelope: input.encrypted.ciphertext, mask: input.secret_mask });
    return id;
  }
  async discardCredentialSet(id: string) { this.credentials.delete(id); }
  async rotateCredentialSet(input: { owner_id: string; credential_set_id: string; secret_mask: string; encrypted: { ciphertext: string } }) {
    const current = this.credentials.get(input.credential_set_id);
    assert.ok(current);
    this.credentials.set(input.credential_set_id, { ...current, envelope: input.encrypted.ciphertext, mask: input.secret_mask });
  }
  async upsertConnection(input: Omit<ConnectionRecord, "id" | "status" | "public_enabled" | "last_synced_at" | "last_error_code">) {
    const collision = this.connections.find((item) => item.provider === input.provider && item.external_account_id_hash === input.external_account_id_hash);
    if (collision && collision.owner_id !== input.owner_id) throw Object.assign(new Error("duplicate key detail must stay private"), { code: "23505" });
    if (collision) {
      Object.assign(collision, input, { status: "active", public_enabled: false });
      return collision;
    }
    const connection: ConnectionRecord = {
      ...input, id: `connection-${this.connections.length + 1}`, status: "active",
      public_enabled: false, last_synced_at: null, last_error_code: "",
    };
    this.connections.push(connection);
    return connection;
  }
  async setPublic(ownerId: string, id: string, enabled: boolean) {
    const connection = await this.get(ownerId, id); if (!connection) throw new Error("exchange_connection_not_found");
    connection.public_enabled = enabled; return connection;
  }
  async disconnect(ownerId: string, id: string) {
    const connection = await this.get(ownerId, id); if (!connection) throw new Error("exchange_connection_not_found");
    connection.status = "disabled"; connection.public_enabled = false; return connection;
  }
  async requestDeletion(ownerId: string, id: string) {
    const connection = await this.get(ownerId, id); if (!connection) throw new Error("exchange_connection_not_found");
    connection.status = "deleting"; return { connection_id: id, hard_delete_after: "2026-12-24T00:00:00.000Z" };
  }
}

function account(id: string, provider: "binance" | "exness" = "binance"): ValidatedAccount {
  return {
    external_account_id: id,
    account_label: `${provider === "exness" ? "Exness" : "Binance"} ${id.slice(-4)}`,
    account_identifier_mask: `••••${id.slice(-4)}`,
    account_currency: provider === "exness" ? "USD" : "USDT",
    products: provider === "exness" ? ["cfd"] : ["usdt_perpetual"],
    read_only_status: "verified",
  };
}

function fixture() {
  const binance = new Adapter("binance", [account("binance-1001")]);
  const exness = new Adapter("exness", [account("exness-2001", "exness"), account("exness-2002", "exness")]);
  const store = new Store();
  const service = new ExchangeConnectionService({
    store, adapters: new Map([["binance", binance], ["exness", exness]]),
    masterKey: Buffer.alloc(32, 7), identityKey: Buffer.alloc(32, 8),
    encrypt: (plain) => ({ ciphertext: Buffer.from(plain).toString("base64"), iv: "iv", auth_tag: "tag", key_version: 1, last_four: "" }),
  });
  return { service, store, binance, exness };
}

test("requires a read-only acknowledgement and returns only masked discovered accounts", async () => {
  const { service } = fixture();
  await assert.rejects(() => service.validate(owner, { provider: "binance", credentials: { apiKey: "secret-api", secretKey: "secret-key" }, read_only_ack: false }), /read_only_ack/);
  const result = await service.validate(owner, { provider: "binance", credentials: { apiKey: "secret-api", secretKey: "secret-key" }, read_only_ack: true });
  assert.deepEqual(result.accounts[0], {
    external_account_ref: result.accounts[0]?.external_account_ref,
    account_label: "Binance 1001", account_identifier_mask: "••••1001",
    account_currency: "USDT", products: ["usdt_perpetual"], read_only_status: "verified",
  });
  assert.equal(JSON.stringify(result).includes("secret-api"), false);
  assert.equal(JSON.stringify(result).includes("binance-1001"), false);
});

test("connects selected Exness accounts with one encrypted credential envelope", async () => {
  const { service, store } = fixture();
  const validated = await service.validate(owner, { provider: "exness", credentials: { apiKey: "exness-key", privateKey: "private-key", accountIds: "exness-2001,exness-2002", trading_scope: "read_only" }, read_only_ack: true });
  const result = await service.connect(owner, {
    provider: "exness", label: "My Exness", credentials: { apiKey: "exness-key", privateKey: "private-key", accountIds: "exness-2001,exness-2002", trading_scope: "read_only" },
    read_only_ack: true, selected_account_refs: validated.accounts.map((item) => item.external_account_ref),
  });
  assert.equal(result.connections.length, 2);
  assert.equal(store.credentials.size, 1);
  assert.equal(new Set(store.connections.map((item) => item.credential_set_id)).size, 1);
  assert.equal(JSON.stringify(result).includes("private-key"), false);
});

test("supports simultaneous providers and reuses the owner's disconnected account", async () => {
  const { service, store } = fixture();
  const first = await service.connect(owner, { provider: "binance", credentials: { apiKey: "key-a", secretKey: "secret-a" }, read_only_ack: true });
  await service.disconnect(owner, first.connections[0]!.id);
  const reused = await service.connect(owner, { provider: "binance", credentials: { apiKey: "key-b", secretKey: "secret-b" }, read_only_ack: true });
  const exness = await service.connect(owner, { provider: "exness", credentials: { apiKey: "key-e", privateKey: "private-e", accountIds: "exness-2001", trading_scope: "read_only" }, read_only_ack: true, selected_account_refs: [(await service.validate(owner, { provider: "exness", credentials: { apiKey: "key-e", privateKey: "private-e", accountIds: "exness-2001", trading_scope: "read_only" }, read_only_ack: true })).accounts[0]!.external_account_ref] });
  assert.equal(reused.connections[0]!.id, first.connections[0]!.id);
  assert.equal(exness.connections[0]!.provider, "exness");
  assert.equal((await service.list(owner)).length, 2);
  assert.equal(store.connections.filter((item) => item.owner_id === owner).length, 2);
});

test("maps cross-user duplicates to account_unavailable without identity details", async () => {
  const { service } = fixture();
  await service.connect(owner, { provider: "binance", credentials: { apiKey: "key-a", secretKey: "secret-a" }, read_only_ack: true });
  await assert.rejects(
    () => service.connect(otherOwner, { provider: "binance", credentials: { apiKey: "key-b", secretKey: "secret-b" }, read_only_ack: true }),
    (error: any) => error.message === "account_unavailable" && error.statusCode === 409,
  );
});

test("rotates one credential set across all references and applies public opt-in per connection", async () => {
  const { service, store } = fixture();
  const validation = await service.validate(owner, { provider: "exness", credentials: { apiKey: "old-key", privateKey: "old-private", accountIds: "exness-2001,exness-2002", trading_scope: "read_only" }, read_only_ack: true });
  const connected = await service.connect(owner, { provider: "exness", credentials: { apiKey: "old-key", privateKey: "old-private", accountIds: "exness-2001,exness-2002", trading_scope: "read_only" }, read_only_ack: true, selected_account_refs: validation.accounts.map((item) => item.external_account_ref) });
  const credentialId = store.connections.find((item) => item.id === connected.connections[0]!.id)!.credential_set_id;
  const before = store.credentials.get(credentialId)!.envelope;
  await service.rotateCredentials(owner, connected.connections[0]!.id, { credentials: { apiKey: "new-key", privateKey: "new-private", accountIds: "exness-2001,exness-2002", trading_scope: "read_only" }, read_only_ack: true });
  assert.notEqual(store.credentials.get(credentialId)!.envelope, before);
  assert.equal(new Set(store.connections.map((item) => item.credential_set_id)).size, 1);
  await service.setPublic(owner, connected.connections[0]!.id, true, true);
  assert.equal((await service.list(owner))[0]!.public_enabled, true);
  assert.equal((await service.list(owner))[1]!.public_enabled, false);
  await assert.rejects(() => service.setPublic(owner, connected.connections[1]!.id, true, false), /public_amounts_consent_required/);
});

test("exposes authenticated multi-account routes without returning credential material", async () => {
  const { service } = fixture();
  const config = loadConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "server-role-key-longer-than-twenty",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key-longer-than-twenty",
    AI_SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
    AUTH_SITE_URL: "https://wavekb.example/",
  });
  const api = {
    async authorize(token: string) { return token === "user-token" ? { id: owner, role: "user" } : null; },
  } as any;
  const server = buildServer({ config, api, exchangeConnections: service });
  assert.equal((await server.inject({ url: "/v1/user/exchange-connections" })).statusCode, 401);
  const validation = await server.inject({
    method: "POST", url: "/v1/user/exchange-connections/validate",
    headers: { authorization: "Bearer user-token" },
    payload: { provider: "binance", credentials: { apiKey: "route-api", secretKey: "route-secret" }, read_only_ack: true },
  });
  assert.equal(validation.statusCode, 200);
  assert.equal(validation.body.includes("route-secret"), false);
  const connected = await server.inject({
    method: "POST", url: "/v1/user/exchange-connections/connect",
    headers: { authorization: "Bearer user-token" },
    payload: { provider: "binance", credentials: { apiKey: "route-api", secretKey: "route-secret" }, read_only_ack: true },
  });
  assert.equal(connected.statusCode, 201);
  assert.equal(connected.body.includes("route-api"), false);
  const connectionId = (connected.json() as any).connections[0].id;
  const published = await server.inject({
    method: "POST", url: `/v1/user/exchange-connections/${connectionId}/public`,
    headers: { authorization: "Bearer user-token" },
    payload: { public_enabled: true, public_amounts_consent: true },
  });
  assert.equal(published.statusCode, 200);
  assert.equal((published.json() as any).connection.public_enabled, true);
});

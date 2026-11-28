import { createHmac } from "node:crypto";
import type { TradingProduct, TradingProvider } from "@wavekb/domain/trading-review";
import type { GatewayConfig } from "../config.ts";
import { encryptSecret, type EncryptedSecret } from "../secrets/crypto.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";
import { BinanceTradingProviderAdapter } from "./providers/binance.ts";
import { BitgetTradingProviderAdapter } from "./providers/bitget.ts";
import { BybitTradingProviderAdapter } from "./providers/bybit.ts";
import {
  isTradingProvider,
  assertProviderCapabilities,
  normalizeProviderCapabilities,
  unavailableCandleCapabilities,
  type ProviderAccount,
  type ProviderCapabilities,
  type TradingProviderAdapter,
  type ValidatedAccount,
} from "./providers/contracts.ts";
import { ExnessTradingProviderAdapter } from "./providers/exness.ts";
import { OkxTradingProviderAdapter } from "./providers/okx.ts";
import { createTradingProviderRegistry } from "./providers/registry.ts";
import { enabledConnectionProviders } from "./provider-flags.ts";

type ConnectionStatus = "pending_verification" | "active" | "error" | "disabled" | "deleting";

export type ConnectionRecord = {
  id: string;
  owner_id: string;
  provider: TradingProvider;
  credential_set_id: string;
  external_account_id_hash: string;
  account_label: string;
  account_identifier_mask: string;
  account_currency: string;
  capabilities: ProviderCapabilities;
  history_coverage_started_at: string | null;
  equity_tracking_started_at: string | null;
  status: ConnectionStatus;
  public_enabled: boolean;
  last_synced_at: string | null;
  last_error_code: string;
};

export type SafeConnection = Omit<ConnectionRecord, "owner_id" | "credential_set_id" | "external_account_id_hash" | "capabilities"> & {
  products: TradingProduct[];
  read_only_status: "verified" | "user_attested";
  capability_status: "ready";
};

type NewConnection = Omit<ConnectionRecord,
  "id" | "status" | "public_enabled" | "last_synced_at" | "last_error_code"
>;

type CredentialSetInput = {
  owner_id: string;
  provider: TradingProvider;
  label: string;
  secret_mask: string;
  encrypted: EncryptedSecret;
};

export interface TradingConnectionStore {
  list(ownerId: string): Promise<ConnectionRecord[]>;
  get(ownerId: string, id: string): Promise<ConnectionRecord | null>;
  listByCredentialSet(ownerId: string, credentialSetId: string): Promise<ConnectionRecord[]>;
  createCredentialSet(input: CredentialSetInput): Promise<string>;
  discardCredentialSet(id: string): Promise<void>;
  rotateCredentialSet(input: {
    owner_id: string;
    credential_set_id: string;
    secret_mask: string;
    encrypted: EncryptedSecret;
  }): Promise<void>;
  upsertConnection(input: NewConnection): Promise<ConnectionRecord>;
  setPublic(ownerId: string, id: string, enabled: boolean): Promise<ConnectionRecord>;
  disconnect(ownerId: string, id: string): Promise<ConnectionRecord>;
  requestDeletion(ownerId: string, id: string): Promise<{ connection_id: string; hard_delete_after: string }>;
}

type Database = { request(path: string, options?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<any> };

const connectionSelect = [
  "id", "owner_id", "provider", "credential_set_id", "external_account_id_hash",
  "account_label", "account_identifier_mask", "account_currency", "capabilities",
  "history_coverage_started_at", "equity_tracking_started_at", "status", "public_enabled",
  "last_synced_at", "last_error_code",
].join(",");

function recordFrom(payload: unknown): ConnectionRecord {
  const item = Array.isArray(payload) ? payload[0] : payload;
  if (!item || typeof item !== "object" || !("id" in item)) {
    throw Object.assign(new Error("exchange_connection_failed"), { statusCode: 500 });
  }
  const row = item as Record<string, unknown>;
  const stringFields = [
    "id", "owner_id", "credential_set_id", "external_account_id_hash", "account_label",
    "account_identifier_mask", "account_currency", "last_error_code",
  ];
  if (!isTradingProvider(row.provider)
    || stringFields.some((field) => typeof row[field] !== "string")
    || !/^(?:\u2022{4}|\*{4})[A-Za-z0-9]{4}$/u.test(String(row.account_identifier_mask))
    || !new Set(["pending_verification", "active", "error", "disabled", "deleting"]).has(String(row.status))
    || typeof row.public_enabled !== "boolean"
    || ["history_coverage_started_at", "equity_tracking_started_at", "last_synced_at"].some(
      (field) => row[field] !== null && typeof row[field] !== "string",
    )) throw Object.assign(new Error("exchange_connection_failed"), { statusCode: 500 });
  return {
    ...row,
    provider: row.provider,
    capabilities: normalizeProviderCapabilities(row.capabilities, { allowLegacyMissingCandles: true }),
  } as ConnectionRecord;
}

function recordsFrom(payload: unknown): ConnectionRecord[] {
  if (!Array.isArray(payload)) throw Object.assign(new Error("exchange_connection_failed"), { statusCode: 500 });
  return payload.map((item) => recordFrom(item));
}

export class SupabaseTradingConnectionStore implements TradingConnectionStore {
  private readonly database: Database;

  constructor(configOrDatabase: GatewayConfig | Database) {
    this.database = "request" in configOrDatabase ? configOrDatabase : new SupabaseRest(configOrDatabase);
  }

  async list(ownerId: string) {
    return recordsFrom(await this.database.request(`/rest/v1/exchange_connections?owner_id=eq.${encodeURIComponent(ownerId)}&status=neq.deleting&select=${connectionSelect}&order=created_at.asc`));
  }

  async get(ownerId: string, id: string) {
    const rows = recordsFrom(await this.database.request(`/rest/v1/exchange_connections?owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${encodeURIComponent(id)}&select=${connectionSelect}&limit=1`));
    return rows[0] ?? null;
  }

  async listByCredentialSet(ownerId: string, credentialSetId: string) {
    return recordsFrom(await this.database.request(`/rest/v1/exchange_connections?owner_id=eq.${encodeURIComponent(ownerId)}&credential_set_id=eq.${encodeURIComponent(credentialSetId)}&status=neq.deleting&select=${connectionSelect}&order=created_at.asc`));
  }

  async createCredentialSet(input: CredentialSetInput) {
    const result = await this.database.request("/rest/v1/rpc/upsert_exchange_credential_set", {
      method: "POST",
      body: {
        p_owner_id: input.owner_id,
        p_provider: input.provider,
        p_label: input.label,
        p_secret_mask: input.secret_mask,
        p_ciphertext: input.encrypted.ciphertext,
        p_iv: input.encrypted.iv,
        p_auth_tag: input.encrypted.auth_tag,
        p_key_version: input.encrypted.key_version,
      },
    });
    const id = String(Array.isArray(result) ? result[0] : result || "");
    if (!id) throw Object.assign(new Error("exchange_connection_failed"), { statusCode: 500 });
    return id;
  }

  async discardCredentialSet(id: string) {
    await this.database.request(`/rest/v1/exchange_credential_sets?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async rotateCredentialSet(input: { owner_id: string; credential_set_id: string; secret_mask: string; encrypted: EncryptedSecret }) {
    await this.database.request("/rest/v1/rpc/rotate_exchange_credential_set", {
      method: "POST",
      body: {
        p_owner_id: input.owner_id,
        p_credential_set_id: input.credential_set_id,
        p_secret_mask: input.secret_mask,
        p_ciphertext: input.encrypted.ciphertext,
        p_iv: input.encrypted.iv,
        p_auth_tag: input.encrypted.auth_tag,
        p_key_version: input.encrypted.key_version,
      },
    });
  }

  async upsertConnection(input: NewConnection) {
    const result = await this.database.request("/rest/v1/rpc/upsert_exchange_connection_v3", {
      method: "POST",
      body: {
        p_owner_id: input.owner_id,
        p_provider: input.provider,
        p_credential_set_id: input.credential_set_id,
        p_external_account_id_hash: input.external_account_id_hash,
        p_account_label: input.account_label,
        p_account_identifier_mask: input.account_identifier_mask,
        p_account_currency: input.account_currency,
        p_capabilities: assertProviderCapabilities(input.capabilities),
        p_history_coverage_started_at: input.history_coverage_started_at,
        p_equity_tracking_started_at: input.equity_tracking_started_at,
      },
    });
    return recordFrom(result);
  }

  async setPublic(ownerId: string, id: string, enabled: boolean) {
    return recordFrom(await this.database.request("/rest/v1/rpc/set_exchange_connection_public_amounts", {
      method: "POST",
      body: { p_owner_id: ownerId, p_connection_id: id, p_public_enabled: enabled, p_public_amounts_consent: enabled },
    }));
  }

  async disconnect(ownerId: string, id: string) {
    return recordFrom(await this.database.request("/rest/v1/rpc/disconnect_exchange_connection_v3", {
      method: "POST", body: { p_owner_id: ownerId, p_connection_id: id },
    }));
  }

  async requestDeletion(ownerId: string, id: string) {
    const result = await this.database.request("/rest/v1/rpc/request_trading_data_deletion", {
      method: "POST", body: { p_owner_id: ownerId, p_connection_id: id },
    });
    const item = Array.isArray(result) ? result[0] : result;
    if (!item?.connection_id || !item?.hard_delete_after) throw Object.assign(new Error("exchange_connection_failed"), { statusCode: 500 });
    return { connection_id: String(item.connection_id), hard_delete_after: String(item.hard_delete_after) };
  }
}

type ConnectInput = {
  provider?: unknown;
  label?: unknown;
  credentials?: unknown;
  read_only_ack?: unknown;
  selected_account_refs?: unknown;
  public_enabled?: unknown;
  public_amounts_consent?: unknown;
};

type ServiceDeps = {
  store: TradingConnectionStore;
  adapters: ReadonlyMap<TradingProvider, TradingProviderAdapter>;
  masterKey: Buffer;
  identityKey: Buffer;
  encrypt?: typeof encryptSecret;
  now?: () => Date;
};

function credentials(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("invalid_exchange_credentials"), { statusCode: 400 });
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || key.length > 80 || item.length > 16_384) {
      throw Object.assign(new Error("invalid_exchange_credentials"), { statusCode: 400 });
    }
    result[key] = item;
  }
  return result;
}

function provider(value: unknown): TradingProvider {
  if (!isTradingProvider(value)) throw Object.assign(new Error("invalid_trading_provider"), { statusCode: 400 });
  return value;
}

function label(value: unknown, fallback: string) {
  const result = String(value || fallback).trim();
  if (result.length < 1 || result.length > 80) throw Object.assign(new Error("invalid_exchange_label"), { statusCode: 400 });
  return result;
}

function defaultCapabilities(account: ValidatedAccount, selectedProvider: TradingProvider): ProviderCapabilities {
  return {
    products: account.products,
    history_age_days: selectedProvider === "exness" ? 0 : 90,
    history_range_days: 7,
    page_size: 100,
    pagination: selectedProvider === "exness" ? "opaque" : "time",
    position_grouping: selectedProvider === "exness" ? "position_id_cycle"
      : selectedProvider === "okx" || selectedProvider === "bitget" ? "hedge_zero_cycle" : "net_zero_cycle",
    has_position_id: selectedProvider === "exness",
    has_realized_pnl: true,
    has_fee_asset: true,
    has_funding_or_swap: true,
    has_external_cash_flow: true,
    has_usd_valuation: account.account_currency === "USD" || account.account_currency === "USDT",
    account_currency: account.account_currency,
    settlement_assets: [account.account_currency],
    valuation_pairs: [],
    candles: unavailableCandleCapabilities(),
  };
}

function safe(connection: ConnectionRecord): SafeConnection {
  const readOnlyStatus = connection.capabilities.read_only_status;
  return {
    id: connection.id,
    provider: connection.provider,
    account_label: connection.account_label,
    account_identifier_mask: connection.account_identifier_mask,
    account_currency: connection.account_currency,
    history_coverage_started_at: connection.history_coverage_started_at,
    equity_tracking_started_at: connection.equity_tracking_started_at,
    status: connection.status,
    public_enabled: connection.public_enabled,
    last_synced_at: connection.last_synced_at,
    last_error_code: connection.last_error_code,
    products: connection.capabilities.products ?? [],
    read_only_status: readOnlyStatus ?? "user_attested",
    capability_status: "ready",
  };
}

function unavailable(error: unknown): never {
  const candidate = error as { message?: string; code?: string; statusCode?: number };
  if (candidate.message === "account_unavailable" || candidate.code === "23505" || candidate.message?.includes("unique")) {
    throw Object.assign(new Error("account_unavailable"), { statusCode: 409 });
  }
  throw error;
}

export class ExchangeConnectionService {
  private readonly store: TradingConnectionStore;
  private readonly adapters: ReadonlyMap<TradingProvider, TradingProviderAdapter>;
  private readonly masterKey: Buffer;
  private readonly identityKey: Buffer;
  private readonly encrypt: typeof encryptSecret;
  private readonly now: () => Date;

  constructor(deps: ServiceDeps) {
    this.store = deps.store;
    this.adapters = deps.adapters;
    this.masterKey = deps.masterKey;
    this.identityKey = deps.identityKey;
    this.encrypt = deps.encrypt ?? encryptSecret;
    this.now = deps.now ?? (() => new Date());
  }

  private adapter(selectedProvider: TradingProvider) {
    const adapter = this.adapters.get(selectedProvider);
    if (!adapter) throw Object.assign(new Error("trading_provider_disabled"), { statusCode: 503 });
    return adapter;
  }

  private accountHash(selectedProvider: TradingProvider, externalId: string) {
    return createHmac("sha256", this.identityKey).update(`${selectedProvider}\0${externalId}`).digest("hex");
  }

  private accountRef(ownerId: string, selectedProvider: TradingProvider, externalId: string) {
    return createHmac("sha256", this.identityKey).update(`${ownerId}\0${selectedProvider}\0${externalId}`).digest("base64url");
  }

  private credentialMask(input: Record<string, string>) {
    const key = input.apiKey ?? input.api_key ?? "";
    return `\u2022\u2022\u2022\u2022${key.slice(-4).padStart(4, "0")}`;
  }

  private encrypted(input: Record<string, string>) {
    const ordered = Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
    return this.encrypt(JSON.stringify(ordered), this.masterKey, 1);
  }

  private async validated(ownerId: string, input: ConnectInput) {
    const selectedProvider = provider(input.provider);
    if (input.read_only_ack !== true) throw Object.assign(new Error("read_only_ack_required"), { statusCode: 400 });
    const credentialInput = credentials(input.credentials);
    const accounts = await this.adapter(selectedProvider).validateCredentials({
      provider: selectedProvider, credentials: credentialInput, read_only_ack: true,
    });
    if (!accounts.length || accounts.length > 10) throw Object.assign(new Error("exchange_accounts_invalid"), { statusCode: 400 });
    if (accounts.some((account) => !/^(?:\u2022{4}|\*{4})[A-Za-z0-9]{4}$/u.test(account.account_identifier_mask))) {
      throw Object.assign(new Error("exchange_accounts_invalid"), { statusCode: 502 });
    }
    return { selectedProvider, credentialInput, accounts: accounts.map((account) => ({
      account,
      ref: this.accountRef(ownerId, selectedProvider, account.external_account_id),
    })) };
  }

  async list(ownerId: string) {
    return (await this.store.list(ownerId)).map(safe);
  }

  async validate(ownerId: string, input: ConnectInput) {
    const result = await this.validated(ownerId, input);
    return {
      provider: result.selectedProvider,
      accounts: result.accounts.map(({ account, ref }) => ({
        external_account_ref: ref,
        account_label: account.account_label,
        account_identifier_mask: account.account_identifier_mask,
        account_currency: account.account_currency,
        products: account.products,
        read_only_status: account.read_only_status,
      })),
    };
  }

  async connect(ownerId: string, input: ConnectInput) {
    const result = await this.validated(ownerId, input);
    const requested = Array.isArray(input.selected_account_refs)
      ? new Set(input.selected_account_refs.filter((item): item is string => typeof item === "string"))
      : null;
    const selected = requested ? result.accounts.filter((item) => requested.has(item.ref)) : result.accounts;
    if (!selected.length || (requested && selected.length !== requested.size)) {
      throw Object.assign(new Error("exchange_account_selection_invalid"), { statusCode: 400 });
    }
    const credentialSetId = await this.store.createCredentialSet({
      owner_id: ownerId,
      provider: result.selectedProvider,
      label: label(input.label, `${result.selectedProvider.toUpperCase()} 只读账户`),
      secret_mask: this.credentialMask(result.credentialInput),
      encrypted: this.encrypted(result.credentialInput),
    });
    const connected: ConnectionRecord[] = [];
    try {
      for (const { account } of selected) {
        const baseCapabilities = defaultCapabilities(account, result.selectedProvider);
        const discovered = assertProviderCapabilities(await this.adapter(result.selectedProvider).discoverCapabilities({
          connection_id: "pending",
          external_account_id: account.external_account_id,
          account_currency: account.account_currency,
          credentials: result.credentialInput,
          capabilities: baseCapabilities,
        }));
        const capabilitiesWithStatus = assertProviderCapabilities({ ...discovered, read_only_status: account.read_only_status });
        connected.push(await this.store.upsertConnection({
          owner_id: ownerId,
          provider: result.selectedProvider,
          credential_set_id: credentialSetId,
          external_account_id_hash: this.accountHash(result.selectedProvider, account.external_account_id),
          account_label: account.account_label,
          account_identifier_mask: account.account_identifier_mask,
          account_currency: account.account_currency,
          capabilities: capabilitiesWithStatus,
          history_coverage_started_at: null,
          equity_tracking_started_at: this.now().toISOString(),
        }));
      }
      if (input.public_enabled === true) {
        if (input.public_amounts_consent !== true) throw Object.assign(new Error("public_amounts_consent_required"), { statusCode: 400 });
        for (let index = 0; index < connected.length; index += 1) {
          connected[index] = await this.store.setPublic(ownerId, connected[index]!.id, true);
        }
      }
      return { connections: connected.map(safe) };
    } catch (error) {
      if (connected.length === 0) await this.store.discardCredentialSet(credentialSetId).catch(() => undefined);
      return unavailable(error);
    }
  }

  async rotateCredentials(ownerId: string, connectionId: string, input: ConnectInput) {
    const connection = await this.store.get(ownerId, connectionId);
    if (!connection) throw Object.assign(new Error("exchange_connection_not_found"), { statusCode: 404 });
    const result = await this.validated(ownerId, { ...input, provider: connection.provider });
    const related = await this.store.listByCredentialSet(ownerId, connection.credential_set_id);
    const validatedHashes = new Set(result.accounts.map(({ account }) => this.accountHash(connection.provider, account.external_account_id)));
    if (related.some((item) => !validatedHashes.has(item.external_account_id_hash))) {
      throw Object.assign(new Error("credential_accounts_mismatch"), { statusCode: 409 });
    }
    await this.store.rotateCredentialSet({
      owner_id: ownerId,
      credential_set_id: connection.credential_set_id,
      secret_mask: this.credentialMask(result.credentialInput),
      encrypted: this.encrypted(result.credentialInput),
    });
    return { connections: related.map(safe) };
  }

  async setPublic(ownerId: string, connectionId: string, enabled: boolean, consent: boolean) {
    if (enabled && !consent) throw Object.assign(new Error("public_amounts_consent_required"), { statusCode: 400 });
    return safe(await this.store.setPublic(ownerId, connectionId, enabled));
  }

  async disconnect(ownerId: string, connectionId: string) {
    return safe(await this.store.disconnect(ownerId, connectionId));
  }

  async requestDeletion(ownerId: string, connectionId: string) {
    return this.store.requestDeletion(ownerId, connectionId);
  }
}

export function createExchangeConnectionService(config: GatewayConfig) {
  const adapters = createTradingProviderRegistry([
    new BinanceTradingProviderAdapter(config.BINANCE_FUTURES_API_URL),
    new OkxTradingProviderAdapter(),
    new BybitTradingProviderAdapter(),
    new BitgetTradingProviderAdapter(),
    new ExnessTradingProviderAdapter(),
  ], enabledConnectionProviders(config));
  return new ExchangeConnectionService({
    store: new SupabaseTradingConnectionStore(config),
    adapters,
    masterKey: config.AI_SECRET_MASTER_KEY,
    identityKey: config.TRADING_ACCOUNT_HMAC_KEY,
  });
}

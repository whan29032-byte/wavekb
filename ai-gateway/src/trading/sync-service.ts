import { createHmac } from "node:crypto";
import type { TradingProvider } from "@wavekb/domain/trading-review";
import type { GatewayConfig } from "../config.ts";
import { decryptSecret, type EncryptedSecret } from "../secrets/crypto.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";
import { valueAmount } from "./accounting.ts";
import {
  reconcileCycleLineage,
  reconstructNetZeroCycles,
  reconstructPositionIdCycles,
  type PreviousCycleIdentity,
  type ReconstructedCycle,
} from "./cycles.ts";
import type {
  CanonicalAccountSnapshot,
  CanonicalCashEvent,
  CanonicalFill,
  ProviderAccount,
  ProviderCapabilities,
  ProviderCursor,
  TradingProviderAdapter,
} from "./providers/contracts.ts";
import { assertCanonicalHistoryBatch } from "./providers/contracts.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_OVERLAP_MS = DAY_MS;
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_MAX_PAGES = 500;

export type SyncConnectionRecord = {
  id: string;
  owner_id: string;
  provider: TradingProvider;
  credential_set_id: string;
  external_account_id_hash: string | null;
  account_currency: string;
  capabilities: ProviderCapabilities;
  sync_generation: number;
  status: "active" | "error";
  last_synced_at: string | null;
  history_coverage_started_at: string | null;
  data_hidden_at: string | null;
};

type PublishedSnapshot = {
  captured_at: string;
  account_currency: string;
  equity: string;
  wallet_balance: string;
  unrealized_pnl: string;
  usd_equity: string | null;
  usd_wallet_balance: string | null;
  usd_unrealized_pnl: string | null;
  valuation_status: string;
  valuation_rate: string | null;
  valuation_source: string | null;
  valuation_path: string[];
  valuation_quoted_at: string | null;
};

type PublishedFill = Omit<CanonicalFill, "realized_pnl" | "fee"> & {
  realized_pnl: string;
  realized_pnl_asset: string;
  realized_pnl_usd: string | null;
  fee: string;
  fee_asset: string;
  fee_usd: string | null;
};

type PublishedCashEvent = Omit<CanonicalCashEvent, "type"> & { event_type: CanonicalCashEvent["type"] };

export type PublishedCycle = ReconstructedCycle & {
  id: string;
  revision: number;
  usd_net_pnl: string | null;
  valuation_status: string;
  is_current: true;
  needs_reconciliation: boolean;
};

export type SyncPublication = {
  connection: SyncConnectionRecord;
  worker_id: string;
  expected_generation: number;
  snapshot: PublishedSnapshot;
  fills: PublishedFill[];
  cash_events: PublishedCashEvent[];
  cycles: PublishedCycle[];
  lineage: Array<{ alias_cycle_id: string; canonical_cycle_id: string; relation: "merged"; source_revision: number }>;
  cursor: ProviderCursor;
  coverage_started_at: string;
  warnings: string[];
};

export interface TradingSyncStore {
  getConnection(id: string): Promise<SyncConnectionRecord | null>;
  listDueConnections(limit: number, cutoff: string, enabledProviders: ReadonlySet<TradingProvider>): Promise<SyncConnectionRecord[]>;
  claim(connectionId: string, workerId: string, now: string, leaseSeconds: number): Promise<boolean>;
  loadCredentialEnvelope(ownerId: string, credentialSetId: string): Promise<EncryptedSecret>;
  bindExternalAccountHash(ownerId: string, connectionId: string, hash: string): Promise<void>;
  loadCursor(connectionId: string): Promise<ProviderCursor | null>;
  loadHistory(connectionId: string): Promise<{
    fills: CanonicalFill[];
    cash_events: CanonicalCashEvent[];
    previous_cycles: PreviousCycleIdentity[];
  }>;
  publish(input: SyncPublication): Promise<number>;
  recordFailure(connection: SyncConnectionRecord, workerId: string, code: string): Promise<void>;
}

type Database = { request(path: string, options?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<any> };

const connectionSelect = [
  "id", "owner_id", "provider", "credential_set_id", "external_account_id_hash",
  "account_currency", "capabilities", "sync_generation", "status", "last_synced_at",
  "history_coverage_started_at", "data_hidden_at",
].join(",");

function canonicalFill(row: Record<string, any>): CanonicalFill {
  return {
    provider: row.provider, connection_id: row.connection_id, native_fill_id: row.native_fill_id,
    native_order_id: row.native_order_id, native_position_id: row.native_position_id,
    symbol: row.symbol, native_symbol: row.native_symbol, product: row.product, side: row.side,
    position_side: row.position_side, action: row.action, price: String(row.price), quantity: String(row.quantity),
    contract_multiplier: String(row.contract_multiplier), occurred_at: row.occurred_at,
    realized_pnl: { amount: String(row.realized_pnl), asset: row.realized_pnl_asset, usd_value: row.realized_pnl_usd == null ? null : String(row.realized_pnl_usd) },
    fee: { amount: String(row.fee), asset: row.fee_asset, usd_value: row.fee_usd == null ? null : String(row.fee_usd) },
    liquidity: row.liquidity,
  };
}

function canonicalCashEvent(row: Record<string, any>): CanonicalCashEvent {
  return {
    provider: row.provider, connection_id: row.connection_id, native_event_id: row.native_event_id,
    native_type: row.native_type, type: row.event_type, amount: String(row.amount), asset: row.asset,
    usd_value: row.usd_value == null ? null : String(row.usd_value), occurred_at: row.occurred_at,
    symbol: row.symbol, native_position_id: row.native_position_id,
  };
}

export class SupabaseTradingSyncStore implements TradingSyncStore {
  private readonly database: Database;

  constructor(configOrDatabase: GatewayConfig | Database) {
    this.database = "request" in configOrDatabase ? configOrDatabase : new SupabaseRest(configOrDatabase);
  }

  async getConnection(id: string) {
    const rows = await this.database.request(`/rest/v1/exchange_connections?id=eq.${encodeURIComponent(id)}&status=in.(active,error)&data_hidden_at=is.null&select=${connectionSelect}&limit=1`) as SyncConnectionRecord[];
    return rows[0] ?? null;
  }

  async listDueConnections(limit: number, cutoff: string, enabledProviders: ReadonlySet<TradingProvider>) {
    if (!enabledProviders.size) return [];
    const providers = [...enabledProviders].map(encodeURIComponent).join(",");
    return this.database.request(`/rest/v1/exchange_connections?provider=in.(${providers})&status=in.(active,error)&data_hidden_at=is.null&or=(last_synced_at.is.null,last_synced_at.lte.${encodeURIComponent(cutoff)})&select=${connectionSelect}&order=last_synced_at.asc.nullsfirst&limit=${Math.min(Math.max(limit, 1), 500)}`) as Promise<SyncConnectionRecord[]>;
  }

  async claim(connectionId: string, workerId: string, now: string, leaseSeconds: number) {
    const result = await this.database.request("/rest/v1/rpc/claim_exchange_sync_connection", {
      method: "POST", body: { p_connection_id: connectionId, p_worker_id: workerId, p_now: now, p_lease_seconds: leaseSeconds },
    });
    return result === true;
  }

  async loadCredentialEnvelope(ownerId: string, credentialSetId: string) {
    const rows = await this.database.request(`/rest/v1/exchange_credential_secrets?owner_id=eq.${encodeURIComponent(ownerId)}&credential_set_id=eq.${encodeURIComponent(credentialSetId)}&active=eq.true&select=ciphertext,iv,auth_tag,key_version&limit=1`) as EncryptedSecret[];
    if (!rows[0]) throw Object.assign(new Error("exchange_secret_missing"), { statusCode: 500 });
    return rows[0];
  }

  async bindExternalAccountHash(ownerId: string, connectionId: string, hash: string) {
    await this.database.request(`/rest/v1/exchange_connections?id=eq.${encodeURIComponent(connectionId)}&owner_id=eq.${encodeURIComponent(ownerId)}&external_account_id_hash=is.null`, {
      method: "PATCH", headers: { prefer: "return=minimal" }, body: { external_account_id_hash: hash },
    });
  }

  async loadCursor(connectionId: string) {
    const rows = await this.database.request(`/rest/v1/trading_sync_cursors?connection_id=eq.${encodeURIComponent(connectionId)}&select=cursor&limit=1`) as Array<{ cursor: ProviderCursor }>;
    return rows[0]?.cursor ?? null;
  }

  async loadHistory(connectionId: string) {
    const encoded = encodeURIComponent(connectionId);
    const [fillRows, cashRows, cycleRows] = await Promise.all([
      this.database.request(`/rest/v1/trading_fills?connection_id=eq.${encoded}&select=provider,connection_id,native_fill_id,native_order_id,native_position_id,symbol,native_symbol,product,side,position_side,action,price,quantity,contract_multiplier,occurred_at,realized_pnl,realized_pnl_asset,realized_pnl_usd,fee,fee_asset,fee_usd,liquidity&order=occurred_at.asc`),
      this.database.request(`/rest/v1/trading_cash_events?connection_id=eq.${encoded}&select=provider,connection_id,native_event_id,native_type,event_type,amount,asset,usd_value,occurred_at,symbol,native_position_id&order=occurred_at.asc`),
      this.database.request(`/rest/v1/trading_trade_cycles?connection_id=eq.${encoded}&is_current=eq.true&select=id,created_at,revision,fill_digest`),
    ]) as [Array<Record<string, any>>, Array<Record<string, any>>, Array<Record<string, any>>];
    let revisions: Array<{ cycle_id: string; facts: Record<string, any> }> = [];
    let reviewedIds = new Set<string>();
    if (cycleRows.length) {
      const ids = cycleRows.map((row) => encodeURIComponent(row.id)).join(",");
      const [revisionRows, reviewRows] = await Promise.all([
        this.database.request(`/rest/v1/trading_trade_cycle_revisions?cycle_id=in.(${ids})&select=cycle_id,facts&order=revision.desc`),
        this.database.request(`/rest/v1/trading_trade_reviews?cycle_id=in.(${ids})&select=cycle_id`),
      ]);
      revisions = revisionRows;
      reviewedIds = new Set((reviewRows as Array<{ cycle_id: string }>).map((item) => item.cycle_id));
    }
    const factsByCycle = new Map<string, Record<string, any>>();
    for (const item of revisions) if (!factsByCycle.has(item.cycle_id)) factsByCycle.set(item.cycle_id, item.facts);
    return {
      fills: fillRows.map(canonicalFill),
      cash_events: cashRows.map(canonicalCashEvent),
      previous_cycles: cycleRows.flatMap((row) => {
        const facts = factsByCycle.get(row.id);
        if (!facts || !Array.isArray(facts.fill_ids) || typeof facts.anchor_fill_id !== "string") return [];
        return [{
          id: row.id, created_at: row.created_at, anchor_fill_id: facts.anchor_fill_id,
          fill_ids: facts.fill_ids.filter((item: unknown): item is string => typeof item === "string"),
          revision: Number(row.revision), fill_digest: String(row.fill_digest), has_review: reviewedIds.has(row.id),
          ...(typeof facts.allocation_digest === "string" ? { allocation_digest: facts.allocation_digest } : {}),
        }];
      }),
    };
  }

  async publish(input: SyncPublication) {
    const result = await this.database.request("/rest/v1/rpc/publish_exchange_sync_generation", {
      method: "POST",
      body: {
        p_connection_id: input.connection.id,
        p_owner_id: input.connection.owner_id,
        p_expected_generation: input.expected_generation,
        p_snapshot: input.snapshot,
        p_fills: input.fills,
        p_cash_events: input.cash_events,
        p_cycles: input.cycles,
        p_lineage: input.lineage,
        p_cursor: input.cursor,
        p_coverage_started_at: input.coverage_started_at,
      },
    });
    const generation = Number(result);
    if (!Number.isInteger(generation) || generation < 1) throw Object.assign(new Error("exchange_sync_publish_failed"), { statusCode: 500 });
    return generation;
  }

  async recordFailure(connection: SyncConnectionRecord, workerId: string, code: string) {
    await this.database.request("/rest/v1/rpc/record_exchange_sync_failure_v3", {
      method: "POST",
      body: { p_connection_id: connection.id, p_owner_id: connection.owner_id, p_worker_id: workerId, p_error_code: code },
    });
  }
}

type ServiceDeps = {
  store: TradingSyncStore;
  adapters: ReadonlyMap<TradingProvider, TradingProviderAdapter>;
  enabledProviders: ReadonlySet<TradingProvider>;
  workerId: string;
  identityKey: Buffer;
  masterKey: Buffer;
  decrypt?: typeof decryptSecret;
  now?: () => number;
  syncIntervalMs?: number;
  overlapMs?: number;
  leaseSeconds?: number;
  maxPages?: number;
};

export type SyncResult =
  | { status: "published"; connection_id: string; generation: number; fills: number; cycles: number; warnings: string[] }
  | { status: "skipped"; connection_id: string; reason: "lease_unavailable" | "manual_throttled" | "provider_disabled" };

export type SyncBatchResult = { checked: number; published: number; skipped: number; failed: number };

export function hashExternalTradingAccount(key: Buffer, provider: TradingProvider, externalAccountId: string) {
  return createHmac("sha256", key).update(`${provider}\0${externalAccountId}`).digest("hex");
}

function safeErrorCode(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "exchange_sync_failed");
  return /^[a-z0-9_-]{3,80}$/i.test(message) ? message : "exchange_sync_failed";
}

function minTimestamp(values: Array<string | null | undefined>, fallback: string) {
  const valid = values.filter((item): item is string => typeof item === "string" && Number.isFinite(Date.parse(item)));
  if (!valid.length) return fallback;
  return valid.reduce((minimum, item) => Date.parse(item) < Date.parse(minimum) ? item : minimum);
}

function mergeById<T>(previous: T[], next: T[], id: (item: T) => string) {
  const values = new Map(previous.map((item) => [id(item), item]));
  for (const item of next) values.set(id(item), item);
  return [...values.values()];
}

function publishedSnapshot(snapshot: CanonicalAccountSnapshot): PublishedSnapshot {
  return {
    captured_at: snapshot.captured_at,
    account_currency: snapshot.account_currency,
    equity: snapshot.equity,
    wallet_balance: snapshot.wallet_balance,
    unrealized_pnl: snapshot.unrealized_pnl,
    usd_equity: snapshot.usd_equity,
    usd_wallet_balance: snapshot.usd_wallet_balance,
    usd_unrealized_pnl: snapshot.usd_unrealized_pnl,
    valuation_status: snapshot.valuation.status,
    valuation_rate: snapshot.valuation.rate,
    valuation_source: snapshot.valuation.source,
    valuation_path: snapshot.valuation.path,
    valuation_quoted_at: snapshot.valuation.quoted_at,
  };
}

function publishedFill(item: CanonicalFill): PublishedFill {
  return {
    ...item,
    realized_pnl: item.realized_pnl.amount,
    realized_pnl_asset: item.realized_pnl.asset,
    realized_pnl_usd: item.realized_pnl.usd_value,
    fee: item.fee.amount,
    fee_asset: item.fee.asset,
    fee_usd: item.fee.usd_value,
  };
}

function publishedCashEvent(item: CanonicalCashEvent): PublishedCashEvent {
  const { type, ...rest } = item;
  return { ...rest, event_type: type };
}

function cycleUsdValue(cycle: ReconstructedCycle, snapshot: CanonicalAccountSnapshot) {
  const currency = cycle.account_currency.toUpperCase();
  const quotes = snapshot.valuation.rate && snapshot.valuation.source && snapshot.valuation.quoted_at
    ? [{ base_asset: currency, quote_asset: "USD", rate: snapshot.valuation.rate, source: snapshot.valuation.source, quoted_at: snapshot.valuation.quoted_at }]
    : [];
  return valueAmount({ amount: cycle.net_pnl, asset: currency, at: cycle.closed_at ?? snapshot.captured_at }, quotes);
}

export class TradingSyncService {
  private readonly store: TradingSyncStore;
  private readonly adapters: ReadonlyMap<TradingProvider, TradingProviderAdapter>;
  private readonly enabledProviders: ReadonlySet<TradingProvider>;
  private readonly workerId: string;
  private readonly identityKey: Buffer;
  private readonly masterKey: Buffer;
  private readonly decrypt: typeof decryptSecret;
  private readonly now: () => number;
  private readonly syncIntervalMs: number;
  private readonly overlapMs: number;
  private readonly leaseSeconds: number;
  private readonly maxPages: number;

  constructor(deps: ServiceDeps) {
    this.store = deps.store;
    this.adapters = deps.adapters;
    this.enabledProviders = deps.enabledProviders;
    this.workerId = deps.workerId;
    this.identityKey = deps.identityKey;
    this.masterKey = deps.masterKey;
    this.decrypt = deps.decrypt ?? decryptSecret;
    this.now = deps.now ?? Date.now;
    this.syncIntervalMs = deps.syncIntervalMs ?? 15 * 60_000;
    this.overlapMs = deps.overlapMs ?? DEFAULT_OVERLAP_MS;
    this.leaseSeconds = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    this.maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  }

  private async providerAccount(connection: SyncConnectionRecord, adapter: TradingProviderAdapter): Promise<ProviderAccount> {
    const encrypted = await this.store.loadCredentialEnvelope(connection.owner_id, connection.credential_set_id);
    let parsed: unknown;
    try { parsed = JSON.parse(this.decrypt(encrypted, this.masterKey)); }
    catch { throw Object.assign(new Error("exchange_secret_invalid"), { statusCode: 500 }); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Object.assign(new Error("exchange_secret_invalid"), { statusCode: 500 });
    const credentials = parsed as Record<string, string>;
    const validated = await adapter.validateCredentials({ provider: connection.provider, credentials, read_only_ack: true });
    const matches = validated.filter((account) => {
      if (!connection.external_account_id_hash) return validated.length === 1;
      return hashExternalTradingAccount(this.identityKey, connection.provider, account.external_account_id) === connection.external_account_id_hash;
    });
    if (matches.length !== 1) throw Object.assign(new Error("exchange_account_unavailable"), { statusCode: 409 });
    const selected = matches[0]!;
    if (!connection.external_account_id_hash) {
      await this.store.bindExternalAccountHash(connection.owner_id, connection.id, hashExternalTradingAccount(this.identityKey, connection.provider, selected.external_account_id));
    }
    return {
      connection_id: connection.id,
      external_account_id: selected.external_account_id,
      account_currency: connection.account_currency,
      credentials,
      capabilities: connection.capabilities,
    };
  }

  private initialCursor(connection: SyncConnectionRecord, stored: ProviderCursor | null): ProviderCursor {
    const kind = connection.capabilities.pagination === "time" ? "time" : "opaque";
    if (connection.history_coverage_started_at && kind === "opaque") return { kind, value: null };
    return stored?.kind === kind ? stored : { kind, value: null };
  }

  async publishGeneration(publication: SyncPublication) {
    return this.store.publish(publication);
  }

  async syncConnection(connectionId: string, options: { manual?: boolean; owner_id?: string } = {}): Promise<SyncResult> {
    const connection = await this.store.getConnection(connectionId);
    if (!connection || (options.owner_id && connection.owner_id !== options.owner_id)) throw Object.assign(new Error("exchange_connection_not_found"), { statusCode: 404 });
    if (!this.enabledProviders.has(connection.provider)) return { status: "skipped", reason: "provider_disabled", connection_id: connection.id };
    const lastSync = Date.parse(connection.last_synced_at ?? "");
    if (options.manual && Number.isFinite(lastSync) && this.now() - lastSync < this.syncIntervalMs) {
      return { status: "skipped", reason: "manual_throttled", connection_id: connection.id };
    }
    const claimed = await this.store.claim(connection.id, this.workerId, new Date(this.now()).toISOString(), this.leaseSeconds);
    if (!claimed) return { status: "skipped", reason: "lease_unavailable", connection_id: connection.id };

    try {
      const adapter = this.adapters.get(connection.provider);
      if (!adapter) throw Object.assign(new Error("trading_provider_disabled"), { statusCode: 503 });
      const account = await this.providerAccount(connection, adapter);
      const [snapshot, storedCursor, history] = await Promise.all([
        adapter.fetchAccountSnapshot(account),
        this.store.loadCursor(connection.id),
        this.store.loadHistory(connection.id),
      ]);
      const initialCursor = this.initialCursor(connection, storedCursor);
      let cursor = initialCursor;
      let publishedCursor = initialCursor;
      let freshFills: CanonicalFill[] = [];
      let freshCash: CanonicalCashEvent[] = [];
      let coverage = connection.history_coverage_started_at ?? snapshot.captured_at;
      const warnings = new Set<string>();
      const recentOverlapBoundary = Number.isFinite(lastSync) ? lastSync - this.overlapMs : null;
      let exhausted = false;

      for (let pageNumber = 0; pageNumber < this.maxPages; pageNumber += 1) {
        const page = await adapter.fetchHistory(account, cursor);
        const normalized = assertCanonicalHistoryBatch(adapter.normalizeHistory(page));
        freshFills = mergeById(freshFills, normalized.fills, (item) => item.native_fill_id);
        freshCash = mergeById(freshCash, normalized.cash_events, (item) => item.native_event_id);
        coverage = minTimestamp([coverage, normalized.coverage_started_at], snapshot.captured_at);
        normalized.warnings.forEach((warning) => warnings.add(warning));
        publishedCursor = normalized.next_cursor ?? cursor;
        exhausted = normalized.exhausted;
        const overlapReached = connection.history_coverage_started_at !== null
          && cursor.kind === "opaque"
          && recentOverlapBoundary !== null
          && Date.parse(normalized.coverage_started_at) <= recentOverlapBoundary;
        if (exhausted || overlapReached) {
          if (overlapReached) publishedCursor = { kind: "opaque", value: null };
          break;
        }
        if (!normalized.next_cursor || (normalized.next_cursor.kind === cursor.kind && normalized.next_cursor.value === cursor.value)) {
          throw Object.assign(new Error("exchange_sync_cursor_stalled"), { statusCode: 502 });
        }
        cursor = normalized.next_cursor;
      }
      if (!exhausted && publishedCursor.kind === cursor.kind && publishedCursor.value === cursor.value) {
        throw Object.assign(new Error("exchange_sync_page_limit"), { statusCode: 502 });
      }
      if (publishedCursor.kind === "time" && publishedCursor.value === null) {
        publishedCursor = { kind: "time", value: String(this.now() - this.overlapMs) };
      }

      const fills = mergeById(history.fills, freshFills, (item) => item.native_fill_id)
        .sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
      const cashEvents = mergeById(history.cash_events, freshCash, (item) => item.native_event_id)
        .sort((left, right) => Date.parse(left.occurred_at) - Date.parse(right.occurred_at));
      const reconstruction = { provider: connection.provider, connection_id: connection.id, account_currency: connection.account_currency, fills, cash_events: cashEvents };
      const reconstructed = connection.capabilities.position_grouping === "position_id_cycle"
        ? reconstructPositionIdCycles(reconstruction)
        : reconstructNetZeroCycles(reconstruction);
      const reconciliation = reconcileCycleLineage(history.previous_cycles, reconstructed);
      const reconciliationIds = new Set(reconciliation.needs_reconciliation.map((item) => item.canonical_cycle_id));
      const cycles = reconciliation.assignments.map((assignment) => {
        const cycle = reconstructed[assignment.candidate_index]!;
        const valuation = cycleUsdValue(cycle, snapshot);
        return {
          ...cycle,
          allocations: cycle.allocations.map((allocation) => ({ ...allocation })),
          id: assignment.id, revision: assignment.revision,
          usd_net_pnl: valuation.usd_value, valuation_status: valuation.status,
          is_current: true as const, needs_reconciliation: reconciliationIds.has(assignment.id),
        };
      });
      if (snapshot.valuation.status === "unavailable") warnings.add("valuation_unavailable");
      if (!connection.history_coverage_started_at && Date.parse(coverage) > this.now() - connection.capabilities.history_age_days * DAY_MS + DAY_MS) {
        warnings.add("partial_history");
      }
      const publication: SyncPublication = {
        connection,
        worker_id: this.workerId,
        expected_generation: connection.sync_generation,
        snapshot: publishedSnapshot(snapshot),
        fills: fills.map(publishedFill),
        cash_events: cashEvents.map(publishedCashEvent),
        cycles,
        lineage: reconciliation.aliases,
        cursor: publishedCursor,
        coverage_started_at: minTimestamp([connection.history_coverage_started_at, coverage], coverage),
        warnings: [...warnings].sort(),
      };
      const generation = await this.publishGeneration(publication);
      return { status: "published", connection_id: connection.id, generation, fills: publication.fills.length, cycles: publication.cycles.length, warnings: publication.warnings };
    } catch (error) {
      await this.store.recordFailure(connection, this.workerId, safeErrorCode(error)).catch(() => undefined);
      throw error;
    }
  }

  async syncDueConnections(limit = 100): Promise<SyncBatchResult> {
    const cutoff = new Date(this.now() - this.syncIntervalMs).toISOString();
    const connections = await this.store.listDueConnections(limit, cutoff, this.enabledProviders);
    const result: SyncBatchResult = { checked: connections.length, published: 0, skipped: 0, failed: 0 };
    for (const connection of connections) {
      try {
        const item = await this.syncConnection(connection.id);
        if (item.status === "published") result.published += 1;
        else result.skipped += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }
}

import type { GatewayConfig } from "../config.ts";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "../secrets/crypto.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";
import { BinanceFuturesClient } from "./binance-futures.ts";

type Connection = {
  id: string;
  owner_id: string;
  label: string;
  public_enabled: boolean;
  public_amounts_consented_at: string | null;
  status: "active" | "error" | "disabled";
  api_key_last_four: string;
  started_at: string;
  last_synced_at: string | null;
  last_error_code: string;
  consecutive_failures: number;
};

type StoredCredentials = { apiKey: string; secretKey: string };

function publicLeaderboardEntry(row: Record<string, unknown>) {
  return {
    rank_no: Number(row.rank_no || 0),
    user_id: String(row.user_id || ""),
    public_uid: Number(row.public_uid || 0),
    display_name: String(row.display_name || ""),
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    display_title: String(row.display_title || ""),
    nameplate_style: String(row.nameplate_style || "classic"),
    return_rate: Number(row.return_rate || 0),
    current_equity_usdt: String(row.current_equity_usdt ?? "0"),
    cumulative_profit_usdt: String(row.cumulative_profit_usdt ?? "0"),
    tracking_started_at: String(row.tracking_started_at || ""),
    last_synced_at: String(row.last_synced_at || ""),
  };
}

function requiredCredential(input: Record<string, unknown>, key: "api_key" | "secret_key") {
  const value = String(input[key] || "").trim();
  if (value.length < 16 || value.length > 512 || /\s/.test(value)) {
    throw Object.assign(new Error(`invalid_${key}`), { statusCode: 400 });
  }
  return value;
}

function connectionValue(payload: unknown): Connection {
  const value = Array.isArray(payload) ? payload[0] : payload;
  if (!value || typeof value !== "object" || !("id" in value)) throw Object.assign(new Error("exchange_connection_failed"), { statusCode: 500 });
  return value as Connection;
}

function safeConnection(connection: Connection | null) {
  if (!connection) return null;
  return {
    id: connection.id,
    label: connection.label,
    exchange: "binance",
    market: "usdm_futures",
    public_enabled: connection.public_enabled,
    public_amounts_consented: Boolean(connection.public_amounts_consented_at),
    status: connection.status,
    secret_mask: `••••${connection.api_key_last_four}`,
    started_at: connection.started_at,
    last_synced_at: connection.last_synced_at,
    last_error_code: connection.last_error_code,
    consecutive_failures: Number(connection.consecutive_failures || 0),
  };
}

function errorCode(error: unknown) {
  const value = String((error as { message?: string })?.message || "exchange_sync_failed");
  return /^[a-z0-9_-]{3,80}$/i.test(value) ? value : "exchange_sync_failed";
}

export class BinanceLeaderboardService {
  private readonly database: SupabaseRest;
  private readonly config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.database = new SupabaseRest(config);
  }

  private client(credentials: StoredCredentials) {
    return new BinanceFuturesClient(credentials.apiKey, credentials.secretKey, this.config.BINANCE_FUTURES_API_URL);
  }

  private async connection(ownerId: string): Promise<Connection | null> {
    const rows = await this.database.request(`/rest/v1/exchange_connections?owner_id=eq.${encodeURIComponent(ownerId)}&status=neq.disabled&select=id,owner_id,label,public_enabled,public_amounts_consented_at,status,api_key_last_four,started_at,last_synced_at,last_error_code,consecutive_failures&order=created_at.desc&limit=1`);
    return rows[0] ?? null;
  }

  async get(ownerId: string) {
    return safeConnection(await this.connection(ownerId));
  }

  async leaderboard(limit = 50) {
    const rows = await this.database.request("/rest/v1/rpc/list_trading_leaderboard", {
      method: "POST",
      body: { p_period: "realtime", p_limit: Math.min(Math.max(Number(limit || 50), 3), 100) },
    });
    return Array.isArray(rows)
      ? rows.map((row) => publicLeaderboardEntry(row as Record<string, unknown>))
      : [];
  }

  async connect(ownerId: string, input: Record<string, unknown>) {
    if (input.read_only_ack !== true) throw Object.assign(new Error("read_only_ack_required"), { statusCode: 400 });
    const publicEnabled = input.public_enabled === true;
    if (publicEnabled && input.public_amounts_consent !== true) {
      throw Object.assign(new Error("public_amounts_consent_required"), { statusCode: 400 });
    }
    const apiKey = requiredCredential(input, "api_key");
    const secretKey = requiredCredential(input, "secret_key");
    const label = String(input.label || "币安 U 本位合约").trim();
    if (label.length < 2 || label.length > 60) throw Object.assign(new Error("invalid_exchange_label"), { statusCode: 400 });
    const snapshot = await this.client({ apiKey, secretKey }).accountSnapshot();
    const capturedAt = new Date().toISOString();
    const encrypted = encryptSecret(JSON.stringify({ apiKey, secretKey }), this.config.AI_SECRET_MASTER_KEY, 1);
    const result = await this.database.request("/rest/v1/rpc/create_binance_exchange_connection_v2", {
      method: "POST",
      body: {
        p_owner_id: ownerId,
        p_label: label,
        p_public_enabled: publicEnabled,
        p_public_amounts_consent: input.public_amounts_consent === true,
        p_api_key_last_four: apiKey.slice(-4),
        p_ciphertext: encrypted.ciphertext,
        p_iv: encrypted.iv,
        p_auth_tag: encrypted.auth_tag,
        p_key_version: encrypted.key_version,
        p_captured_at: capturedAt,
        p_equity_usdt: snapshot.equityUsdt,
        p_wallet_balance_usdt: snapshot.walletBalanceUsdt,
        p_unrealized_pnl_usdt: snapshot.unrealizedPnlUsdt,
      },
    });
    return safeConnection(connectionValue(result));
  }

  private async credentials(connection: Connection): Promise<StoredCredentials> {
    const rows = await this.database.request(`/rest/v1/exchange_connection_secrets?connection_id=eq.${encodeURIComponent(connection.id)}&owner_id=eq.${encodeURIComponent(connection.owner_id)}&active=eq.true&select=ciphertext,iv,auth_tag,key_version&limit=1`);
    if (!rows.length) throw Object.assign(new Error("exchange_secret_missing"), { statusCode: 500 });
    const plain = decryptSecret(rows[0] as EncryptedSecret, this.config.AI_SECRET_MASTER_KEY);
    const parsed = JSON.parse(plain) as Partial<StoredCredentials>;
    if (!parsed.apiKey || !parsed.secretKey) throw Object.assign(new Error("exchange_secret_invalid"), { statusCode: 500 });
    return { apiKey: parsed.apiKey, secretKey: parsed.secretKey };
  }

  async sync(ownerId: string, force = false) {
    const connection = await this.connection(ownerId);
    if (!connection) throw Object.assign(new Error("exchange_connection_not_found"), { statusCode: 404 });
    const lastSync = Date.parse(connection.last_synced_at || "");
    if (!force && Number.isFinite(lastSync) && Date.now() - lastSync < this.config.TRADING_SYNC_MINUTES * 60_000) return safeConnection(connection);
    try {
      const previousRows = await this.database.request(`/rest/v1/trading_equity_snapshots?connection_id=eq.${encodeURIComponent(connection.id)}&select=captured_at&order=captured_at.desc&limit=1`);
      const previousAt = Date.parse(previousRows[0]?.captured_at || connection.started_at);
      const capturedAt = new Date().toISOString();
      const capturedAtMs = Date.parse(capturedAt);
      const maximumIncomeHistoryWindowMs = 89 * 24 * 60 * 60 * 1000;
      if (!Number.isFinite(previousAt) || capturedAtMs - previousAt > maximumIncomeHistoryWindowMs) {
        throw Object.assign(new Error("exchange_sync_gap_too_large"), { statusCode: 409 });
      }
      const client = this.client(await this.credentials(connection));
      const [snapshot, netFlow] = await Promise.all([
        client.accountSnapshot(),
        client.netExternalTransfers(previousAt + 1, capturedAtMs),
      ]);
      await this.database.request("/rest/v1/rpc/record_binance_equity_snapshot", {
        method: "POST",
        body: {
          p_connection_id: connection.id,
          p_owner_id: ownerId,
          p_captured_at: capturedAt,
          p_equity_usdt: snapshot.equityUsdt,
          p_wallet_balance_usdt: snapshot.walletBalanceUsdt,
          p_unrealized_pnl_usdt: snapshot.unrealizedPnlUsdt,
          p_net_external_flow_usdt: netFlow,
        },
      });
      return safeConnection({ ...connection, status: "active", last_synced_at: capturedAt, last_error_code: "", consecutive_failures: 0 });
    } catch (error) {
      await this.database.request("/rest/v1/rpc/record_exchange_sync_failure", {
        method: "POST",
        body: {
          p_connection_id: connection.id,
          p_owner_id: ownerId,
          p_error_code: errorCode(error),
        },
      }).catch(() => undefined);
      throw error;
    }
  }

  async setPublic(ownerId: string, enabled: boolean) {
    const connection = await this.connection(ownerId);
    if (!connection) throw Object.assign(new Error("exchange_connection_not_found"), { statusCode: 404 });
    const result = await this.database.request("/rest/v1/rpc/set_exchange_connection_public_amounts", {
      method: "POST",
      body: {
        p_owner_id: ownerId,
        p_connection_id: connection.id,
        p_public_enabled: enabled,
        p_public_amounts_consent: enabled,
      },
    });
    return safeConnection(connectionValue(result));
  }

  async disconnect(ownerId: string) {
    const connection = await this.connection(ownerId);
    if (!connection) return null;
    await this.database.request("/rest/v1/rpc/disconnect_exchange_connection", { method: "POST", body: { p_owner_id: ownerId, p_connection_id: connection.id } });
    return { ...safeConnection(connection), status: "disabled", public_enabled: false, public_amounts_consented: false };
  }

  async adminList(limit = 100) {
    const rows = await this.database.request(`/rest/v1/exchange_connections?select=id,owner_id,label,public_enabled,public_amounts_consented_at,status,api_key_last_four,started_at,last_synced_at,last_error_code,consecutive_failures,created_at&order=created_at.desc&limit=${Math.min(Math.max(limit, 1), 500)}`) as Array<Connection & { created_at: string }>;
    const ownerIds = [...new Set(rows.map((row) => row.owner_id))];
    const profiles = ownerIds.length ? await this.database.request(`/rest/v1/profiles?id=in.(${ownerIds.map(encodeURIComponent).join(",")})&select=id,public_uid,display_name`) : [];
    const profileById = new Map(profiles.map((profile: { id: string }) => [profile.id, profile]));
    return rows.map((row) => ({ ...safeConnection(row), owner_id: row.owner_id, owner: profileById.get(row.owner_id) ?? null, created_at: row.created_at }));
  }

  async adminDisable(actorId: string, connectionId: string, reason: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) throw Object.assign(new Error("invalid_request"), { statusCode: 400 });
    const note = String(reason || "").trim();
    if (note.length < 2 || note.length > 500) throw Object.assign(new Error("reason_required"), { statusCode: 400 });
    const result = await this.database.request("/rest/v1/rpc/admin_disable_exchange_connection", { method: "POST", body: { p_actor: actorId, p_connection_id: connectionId, p_reason: note } });
    return safeConnection(connectionValue(result));
  }

  async syncDue(limit = 100) {
    const cutoff = new Date(Date.now() - this.config.TRADING_SYNC_MINUTES * 60_000).toISOString();
    const rows = await this.database.request(`/rest/v1/exchange_connections?status=in.(active,error)&or=(last_synced_at.is.null,last_synced_at.lte.${encodeURIComponent(cutoff)})&select=owner_id&order=last_synced_at.asc.nullsfirst&limit=${Math.min(Math.max(limit, 1), 500)}`);
    let synced = 0;
    let failed = 0;
    for (const row of rows) {
      try { await this.sync(String(row.owner_id), true); synced += 1; }
      catch { failed += 1; }
    }
    return { checked: rows.length, synced, failed };
  }
}

import { DatabaseSync } from "node:sqlite";
import { closeSync, existsSync, lstatSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { isRecord } from "./client.ts";
import type { TlineRecord } from "./client.ts";

export type SyncState = { lastSuccess: string | null; watermark: string | null; lastAttempt: string | null; errorCode: string | null; retryAt: string | null };
export type StoreQuery = { since: string; until: string; q: string; institution: string; page: number };
const SCHEMA = 1;
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en");
function content(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(content).join(" ");
  if (isRecord(value)) return Object.values(value).map(content).join(" ");
  return "";
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid research timestamp");
  return new Date(value).toISOString();
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || value === "." || value === ".." || /[\u0000-\u001f]/.test(value)) throw new Error("Invalid research identifier");
  return value;
}
function safePath(file: string, mustExist: boolean): void {
  if (!isAbsolute(file) || resolve(file) !== file) throw new Error("Research database requires an absolute canonical path");
  const parent = dirname(file);
  if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) throw new Error("Unsafe research database directory");
  for (const candidate of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    // lstat catches dangling links too (existsSync does not).
    try { if (!lstatSync(candidate).isFile()) throw new Error("Unsafe research database file"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || (candidate === file && mustExist)) throw error; }
  }
}

export class ResearchStore {
  #db: DatabaseSync;
  #readOnly: boolean;
  #closed = false;
  constructor(file: string, options: { readOnly?: boolean } = {}) {
    this.#readOnly = options.readOnly ?? false;
    safePath(file, this.#readOnly);
    let created = false;
    if (!this.#readOnly && !existsSync(file)) { closeSync(openSync(file, "wx", 0o600)); created = true; }
    this.#db = new DatabaseSync(file, { readOnly: this.#readOnly });
    try {
      this.#db.exec("PRAGMA busy_timeout=1000");
      if (created) {
        this.#db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE institutions(slug TEXT PRIMARY KEY, name TEXT NOT NULL, raw TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE research(id TEXT PRIMARY KEY, institution_slug TEXT NOT NULL, published_at TEXT, ingested_at TEXT NOT NULL, raw TEXT NOT NULL, search_text TEXT NOT NULL, first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE INDEX research_ingested ON research(ingested_at DESC, id DESC);
          CREATE INDEX research_institution ON research(institution_slug, ingested_at DESC, id DESC);
          CREATE TABLE sync_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), schema_version INTEGER NOT NULL, first_success TEXT, last_success TEXT, watermark TEXT, last_attempt TEXT, result TEXT, error_code TEXT, retry_at TEXT, lease_owner TEXT, lease_expires INTEGER);
          INSERT INTO sync_state(singleton,schema_version) VALUES(1,${SCHEMA});
          PRAGMA user_version=${SCHEMA}; COMMIT;`);
      }
      const version = this.#db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== SCHEMA || this.#db.prepare("SELECT schema_version FROM sync_state WHERE singleton=1").get()?.schema_version !== SCHEMA) throw new Error("Unsupported research database schema");
      // Full-file integrity checks belong to writer/ops startup, not request readers.
      if (!this.#readOnly && this.#db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok") throw new Error("Corrupt research database");
      // Validate expected columns before enabling WAL; never repair unfamiliar databases.
      this.#db.prepare("SELECT slug,name,raw,updated_at FROM institutions LIMIT 0");
      this.#db.prepare("SELECT id,institution_slug,published_at,ingested_at,raw,search_text,first_seen_at,updated_at FROM research LIMIT 0");
      this.#db.prepare("SELECT first_success,last_success,watermark,last_attempt,result,error_code,retry_at,lease_owner,lease_expires FROM sync_state LIMIT 0");
      if (!this.#readOnly) this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    } catch (error) { this.#db.close(); throw error; }
  }
  #write() { if (this.#readOnly) throw new Error("Research store is read-only"); }
  #transaction<T>(write: boolean, action: () => T): T {
    if (write) this.#write();
    this.#db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try { const value = action(); this.#db.exec("COMMIT"); return value; }
    catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  status(): SyncState {
    const row = this.#db.prepare("SELECT last_success AS lastSuccess,watermark,last_attempt AS lastAttempt,error_code AS errorCode,retry_at AS retryAt FROM sync_state WHERE singleton=1").get();
    return row as SyncState;
  }
  publish(institutions: TlineRecord[], reports: TlineRecord[], startedAt: string, finishedAt: string, owner?: string, assertCurrent?: () => void): void {
    this.#write();
    const start = timestamp(startedAt), finish = timestamp(finishedAt);
    if (finish < start) throw new Error("Invalid sync interval");
    const banks = institutions.map((row) => { if (!isRecord(row)) throw new Error("Invalid institution"); return { slug: identifier(row.slug), name: typeof row.name === "string" ? row.name : "", raw: JSON.stringify(row) }; });
    const prepared = reports.map((row) => {
      if (!isRecord(row)) throw new Error("Invalid research record");
      const institution = isRecord(row.institution) ? row.institution : {};
      const slug = typeof institution.slug === "string" ? institution.slug : "";
      return { id: identifier(row.id), slug, published: typeof row.publishedAt === "string" && Number.isFinite(Date.parse(row.publishedAt)) ? new Date(row.publishedAt).toISOString() : null, ingested: timestamp(row.ingestedAt), raw: JSON.stringify(row), search: normalize(content([row.title, institution.name, row.analysis, row.assets, row.views])) };
    });
    this.#transaction(true, () => {
      assertCurrent?.();
      if (owner && !this.ownsLease(owner, Date.parse(finish))) throw new Error("Research sync lease lost");
      const bank = this.#db.prepare("INSERT INTO institutions VALUES(?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,raw=excluded.raw,updated_at=excluded.updated_at");
      for (const row of banks) bank.run(row.slug, row.name, row.raw, finish);
      const report = this.#db.prepare("INSERT INTO research VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET institution_slug=excluded.institution_slug,published_at=excluded.published_at,ingested_at=excluded.ingested_at,raw=excluded.raw,search_text=excluded.search_text,updated_at=excluded.updated_at");
      for (const row of prepared) report.run(row.id, row.slug, row.published, row.ingested, row.raw, row.search, finish, finish);
      assertCurrent?.();
      this.#db.prepare("UPDATE sync_state SET first_success=COALESCE(first_success,?),last_success=?,watermark=?,last_attempt=?,result='synced',error_code=NULL,retry_at=NULL WHERE singleton=1").run(finishedAt, finishedAt, startedAt, startedAt);
    });
  }
  failure(at: string, code: string, retryAt: string | null): void {
    this.#write();
    const allowed = new Set(["not_configured", "unauthorized", "forbidden", "rate_limited", "network_error", "invalid_response", "repeated_cursor", "page_limit", "record_limit", "deadline_exceeded", "storage_error", "sync_failed"]);
    this.#db.prepare("UPDATE sync_state SET last_attempt=?,result='failed',error_code=?,retry_at=? WHERE singleton=1").run(timestamp(at), allowed.has(code) ? code : "sync_failed", retryAt ? timestamp(retryAt) : null);
  }
  query(query: StoreQuery) {
    const since = timestamp(query.since), until = timestamp(query.until);
    if (since > until || typeof query.q !== "string" || query.q.length > 200 || typeof query.institution !== "string" || query.institution.length > 200 || !Number.isSafeInteger(query.page) || query.page < 1) throw new Error("Invalid research query");
    return this.#transaction(false, () => {
      const institutions = this.institutions();
      // The window, count, options, and selected rows all share one read snapshot.
      const window = "r.ingested_at>=? AND r.ingested_at<=? AND r.first_seen_at<=?";
      const params = [since, until, until];
      const available = Number(this.#db.prepare(`SELECT COUNT(*) AS n FROM research r WHERE ${window}`).get(...params)?.n);
      const options = this.#db.prepare(`SELECT DISTINCT r.institution_slug AS slug, COALESCE(NULLIF(json_extract(r.raw,'$.institution.name'),''),NULLIF(i.name,''),'未提供机构') AS name FROM research r LEFT JOIN institutions i ON i.slug=r.institution_slug WHERE ${window} AND r.institution_slug<>'' ORDER BY r.id DESC`).all(...params);
      const institutionOptions = [...new Map(options.map((row) => [String(row.slug), { slug: String(row.slug), name: String(row.name) }])).values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      let where = window;
      if (query.institution) { where += " AND r.institution_slug=?"; params.push(query.institution); }
      // Normalize institution names in JS before binding; SQLite LOWER does not implement NFKC.
      const terms = normalize(query.q).split(/\s+/).filter(Boolean);
      for (const term of terms) {
        const bankSlugs = institutions.filter((row) => normalize(typeof row.name === "string" ? row.name : "").includes(term)).map((row) => String(row.slug));
        where += ` AND (r.search_text LIKE ? ESCAPE '\\'${bankSlugs.length ? ` OR (COALESCE(TRIM(json_extract(r.raw,'$.institution.name')),'')='' AND r.institution_slug IN (${bankSlugs.map(() => "?").join(",")}))` : ""})`;
        params.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`, ...bankSlugs);
      }
      const total = Number(this.#db.prepare(`SELECT COUNT(*) AS n FROM research r WHERE ${where}`).get(...params)?.n);
      const pages = Math.max(1, Math.ceil(total / 30)), page = Math.min(query.page, pages);
      const data = this.#db.prepare(`SELECT r.raw FROM research r WHERE ${where} ORDER BY r.ingested_at DESC,r.id DESC LIMIT 30 OFFSET ?`).all(...params, (page - 1) * 30).map((row) => JSON.parse(String(row.raw)) as TlineRecord);
      return { data, institutions, total, available, page, pages, institutionOptions };
    });
  }
  detail(id: string): TlineRecord | null { const row = this.#db.prepare("SELECT raw FROM research WHERE id=?").get(id); return row ? JSON.parse(String(row.raw)) as TlineRecord : null; }
  institutions(): TlineRecord[] { return this.#db.prepare("SELECT raw FROM institutions ORDER BY slug").all().map((row) => JSON.parse(String(row.raw)) as TlineRecord); }
  backupTo(file: string): void {
    this.#write(); safePath(file, false);
    // Reserve exclusively and privately; VACUUM INTO permits an empty target.
    closeSync(openSync(file, "wx", 0o600));
    this.#db.prepare("VACUUM INTO ?").run(file);
  }
  acquireLease(owner: string, now: number): boolean {
    this.#write();
    return this.#db.prepare("UPDATE sync_state SET lease_owner=?,lease_expires=? WHERE singleton=1 AND (lease_owner IS NULL OR lease_expires<=?)").run(owner, now + 15 * 60000, now).changes === 1;
  }
  ownsLease(owner: string, now: number): boolean { return Boolean(this.#db.prepare("SELECT 1 FROM sync_state WHERE singleton=1 AND lease_owner=? AND lease_expires>?").get(owner, now)); }
  releaseLease(owner: string): void { this.#write(); this.#db.prepare("UPDATE sync_state SET lease_owner=NULL,lease_expires=NULL WHERE singleton=1 AND lease_owner=?").run(owner); }
  close(): void { if (!this.#closed) { this.#db.close(); this.#closed = true; } }
}

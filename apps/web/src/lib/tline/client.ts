export type TlineRecord = Record<string, unknown>;
export type ResearchPage = { data: TlineRecord[]; nextCursor: string | null };
type Options = { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; deadline?: number };
const BASE = "https://tlines.tech/api/v1/";

export class TlineError extends Error {
  status: number;
  code: string;
  retryAfterSeconds?: number;
  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message); this.name = "TlineError"; this.status = status; this.code = code; this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isRecord(value: unknown): value is TlineRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class TlineClient {
  #key: string;
  #fetch: typeof fetch;
  #sleep: (ms: number) => Promise<void>;
  #now: () => number;
  #deadline: number;
  constructor(options: Options = {}) {
    this.#key = process.env.TLINE_API_KEY?.trim() ?? "";
    if (!this.#key) throw new TlineError(503, "not_configured", "TLINE_API_KEY is not configured");
    this.#fetch = options.fetcher ?? fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#now = options.now ?? Date.now;
    this.#deadline = options.deadline ?? Infinity;
  }

  #remaining(): number {
    const remaining = this.#deadline - this.#now();
    if (remaining <= 0) throw new TlineError(504, "deadline_exceeded", "Tline worker deadline exceeded");
    return remaining;
  }

  async #bounded<T>(action: () => Promise<T>, maximum: number): Promise<T> {
    const delay = Math.min(maximum, this.#remaining());
    if (!Number.isFinite(delay)) return action();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([action(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TlineError(504, this.#now() >= this.#deadline ? "deadline_exceeded" : "network_error", "Tline request timed out")), delay);
      })]);
    } finally { clearTimeout(timer); }
  }

  async #get(path: string, query: Record<string, string> = {}): Promise<TlineRecord> {
    const url = new URL(path, BASE);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      const timeout = Math.max(1, Math.floor(Math.min(20_000, this.#remaining())));
      try {
        response = await this.#bounded(() => this.#fetch(url, { headers: { Authorization: `Bearer ${this.#key}`, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeout) }), timeout);
      } catch {
        // No request objects, headers, raw error causes or credentials escape.
        this.#remaining();
        throw new TlineError(502, "network_error", "Tline request failed or timed out");
      }
      const envelope: unknown = await this.#bounded(() => response.json().catch(() => null), 20_000);
      if (response.ok) {
        if (!isRecord(envelope) || !("data" in envelope)) throw new TlineError(502, "invalid_response", "Invalid Tline response");
        return envelope;
      }
      const apiError = isRecord(envelope) && isRecord(envelope.error) ? envelope.error : {};
      const clean = (value: unknown, fallback: string) => typeof value === "string" ? value.replaceAll(this.#key, "[REDACTED]").slice(0, 500) : fallback;
      const retryHeader = response.headers.get("Retry-After");
      let delay = 1000 * 2 ** attempt;
      if (retryHeader?.trim()) {
        const value = retryHeader.trim();
        const parsed = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - this.#now();
        if (Number.isFinite(parsed)) delay = Math.max(0, parsed);
      }
      const error = new TlineError(response.status, clean(apiError.code, `http_${response.status}`), clean(apiError.message, `Tline returned HTTP ${response.status}`), response.status === 429 ? Math.ceil(delay / 1000) : undefined);
      // Only 429 retries, at most three. A long requested wait is surfaced rather
      // than shortened (which would violate the server's rate limit).
      if (response.status !== 429 || attempt >= 3 || delay > 120_000 || delay >= this.#remaining()) throw error;
      await this.#bounded(() => this.#sleep(delay), Infinity);
    }
  }

  #array(value: unknown): TlineRecord[] {
    if (!Array.isArray(value) || !value.every(isRecord)) throw new TlineError(502, "invalid_response", "Invalid Tline data array");
    return value;
  }
  async institutions(): Promise<TlineRecord[]> {
    return this.#array((await this.#get("institutions")).data);
  }
  async researchPage(since: string, cursor?: string): Promise<ResearchPage> {
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(since) || !Number.isFinite(Date.parse(since))) throw new TlineError(400, "invalid_since", "since must be an ISO timestamp");
    if (cursor !== undefined && (!cursor || cursor.length > 2048)) throw new TlineError(400, "invalid_cursor", "Invalid cursor");
    const value = await this.#get("research", { since, limit: "200", ...(cursor ? { cursor } : {}) });
    if (value.nextCursor !== null && (typeof value.nextCursor !== "string" || !value.nextCursor || value.nextCursor.length > 2048)) throw new TlineError(502, "invalid_response", "Invalid Tline nextCursor");
    return { data: this.#array(value.data), nextCursor: value.nextCursor as string | null };
  }
  async *researchSince(since: string, cursor?: string): AsyncGenerator<TlineRecord> {
    const seen = new Set<string>(cursor ? [cursor] : []);
    for (;;) {
      const page = await this.researchPage(since, cursor);
      if (page.nextCursor && seen.has(page.nextCursor)) throw new TlineError(502, "repeated_cursor", "Tline repeated a cursor");
      for (const item of page.data) yield item;
      if (page.nextCursor === null) return;
      seen.add(page.nextCursor); cursor = page.nextCursor;
    }
  }
  async research(id: string): Promise<TlineRecord> {
    if (!id || id === "." || id === ".." || id.length > 200) throw new TlineError(400, "invalid_id", "Invalid research ID");
    const value = (await this.#get(`research/${encodeURIComponent(id)}`)).data;
    if (!isRecord(value)) throw new TlineError(502, "invalid_response", "Invalid Tline research detail");
    return value;
  }
  async consensus(ticker = "SPX"): Promise<TlineRecord[]> {
    if (!/^[A-Za-z0-9.^:_-]{1,32}$/.test(ticker)) throw new TlineError(400, "invalid_ticker", "Invalid ticker");
    return this.#array((await this.#get("consensus", { ticker })).data);
  }
}

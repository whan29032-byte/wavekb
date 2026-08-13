import type { GatewayConfig } from "../config.ts";

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export class SupabaseRest {
  constructor(privateConfig: GatewayConfig) {
    this.config = privateConfig;
  }
  private readonly config: GatewayConfig;

  async request(path: string, options: RequestOptions = {}): Promise<any> {
    const response = await fetch(`${this.config.SUPABASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        apikey: this.config.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${this.config.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    if (!response.ok) {
      throw Object.assign(new Error(payload?.message || `database request failed: ${response.status}`), {
        status: response.status,
      });
    }
    return payload;
  }

  async userForJwt(jwt: string): Promise<{ id: string; email?: string } | null> {
    const response = await fetch(`${this.config.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: this.config.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${jwt}`,
      },
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error("authentication service unavailable");
    const user = await response.json();
    return user?.id ? { id: user.id, ...(user.email ? { email: user.email } : {}) } : null;
  }
}

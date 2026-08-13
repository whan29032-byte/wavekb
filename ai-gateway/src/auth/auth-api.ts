import type { GatewayConfig } from "../config.ts";
import {
  authError,
  type AuthSessionResult,
  type UidSelectionState,
} from "./contracts.ts";
import { classifyIdentifier, validateUid } from "./uid.ts";

type FetchLike = typeof fetch;

type AuthorizedUser = {
  id: string;
  emailConfirmed: boolean;
};

function parseJson(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw authError("service_unavailable", 503);
  }
}

function selectionState(payload: any): UidSelectionState {
  const candidates = Array.isArray(payload?.candidate_uids)
    ? payload.candidate_uids.map(validateUid)
    : [];
  const selectedUid = payload?.selected_uid == null
    ? null
    : validateUid(payload.selected_uid);
  const publicUid = payload?.public_uid == null
    ? null
    : validateUid(payload.public_uid);
  const status = String(payload?.status || "");
  if (!["pending", "completed", "expired"].includes(status)) {
    throw authError("service_unavailable", 503);
  }
  return {
    candidateUids: candidates,
    selectedUid,
    refreshesUsed: Number(payload?.refreshes_used || 0),
    refreshesRemaining: Number(payload?.refreshes_remaining || 0),
    expiresAt: String(payload?.expires_at || ""),
    status: status as UidSelectionState["status"],
    publicUid,
  };
}

export class AuthApi {
  private readonly config: GatewayConfig;
  private readonly fetchImpl: FetchLike;

  constructor(
    config: GatewayConfig,
    fetchImpl: FetchLike = fetch,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<{ response: Response; payload: any }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.SUPABASE_URL}${path}`, init);
    } catch {
      throw authError("service_unavailable", 503);
    }
    const payload = parseJson(await response.text());
    return { response, payload };
  }

  private async serviceRequest(path: string, init: RequestInit = {}): Promise<any> {
    const { response, payload } = await this.request(path, {
      ...init,
      headers: {
        apikey: this.config.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${this.config.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) throw authError("service_unavailable", 503);
    return payload;
  }

  private async rpc(jwt: string, name: string, body: object = {}): Promise<UidSelectionState> {
    const { response, payload } = await this.request(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: this.config.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const message = String(payload?.message || "");
      if (/email_confirmation_required/i.test(message)) {
        throw authError("email_confirmation_required", 403);
      }
      if (/uid_refresh_exhausted/i.test(message)) {
        throw authError("uid_refresh_exhausted", 409);
      }
      if (/uid_selection_expired/i.test(message)) {
        throw authError("uid_selection_expired", 409);
      }
      if (/uid_selection_invalid/i.test(message)) {
        throw authError("uid_selection_invalid", 404);
      }
      if (/uid_already_assigned/i.test(message)) {
        throw authError("uid_already_assigned", 409);
      }
      if (/uid_unavailable/i.test(message)) {
        throw authError("uid_unavailable", 409);
      }
      if (response.status === 401 || response.status === 403) {
        throw authError("authentication_required", 401);
      }
      throw authError("service_unavailable", 503);
    }
    return selectionState(payload);
  }

  async authorize(jwt: string): Promise<AuthorizedUser | null> {
    if (!jwt) return null;
    const { response, payload } = await this.request("/auth/v1/user", {
      headers: {
        apikey: this.config.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${jwt}`,
      },
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok || !payload?.id) {
      throw authError("service_unavailable", 503);
    }
    return {
      id: String(payload.id),
      emailConfirmed: Boolean(payload.email_confirmed_at || payload.confirmed_at),
    };
  }

  private async requireConfirmed(jwt: string): Promise<AuthorizedUser> {
    const user = await this.authorize(jwt);
    if (!user) throw authError("authentication_required", 401);
    if (!user.emailConfirmed) {
      throw authError("email_confirmation_required", 403);
    }
    return user;
  }

  async startSelection(jwt: string): Promise<UidSelectionState> {
    await this.requireConfirmed(jwt);
    return this.rpc(jwt, "start_uid_selection");
  }

  async selectionState(jwt: string): Promise<UidSelectionState> {
    await this.requireConfirmed(jwt);
    return this.rpc(jwt, "get_uid_selection_state");
  }

  async refreshSelection(jwt: string): Promise<UidSelectionState> {
    await this.requireConfirmed(jwt);
    return this.rpc(jwt, "refresh_uid_selection");
  }

  async selectCandidate(jwt: string, uid: unknown): Promise<UidSelectionState> {
    await this.requireConfirmed(jwt);
    return this.rpc(jwt, "select_uid_candidate", { chosen_uid: validateUid(uid) });
  }

  async completeSelection(jwt: string): Promise<UidSelectionState> {
    await this.requireConfirmed(jwt);
    return this.rpc(jwt, "complete_uid_selection");
  }

  async login(identifierValue: string, passwordValue: string): Promise<AuthSessionResult> {
    const identifier = classifyIdentifier(identifierValue);
    const password = String(passwordValue || "");
    if (!password || password.length > 1024) {
      throw authError("invalid_credentials", 401);
    }

    let email = identifier.value;
    if (identifier.kind === "uid") {
      const uid = validateUid(identifier.value);
      const profiles = await this.serviceRequest(
        `/rest/v1/profiles?public_uid=eq.${uid}&select=id&limit=1`,
      );
      const userId = profiles?.[0]?.id;
      if (!userId) throw authError("invalid_credentials", 401);
      const authUser = await this.serviceRequest(
        `/auth/v1/admin/users/${encodeURIComponent(String(userId))}`,
      );
      if (!authUser?.email) throw authError("invalid_credentials", 401);
      email = String(authUser.email);
    }

    const { response, payload } = await this.request(
      "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: {
          apikey: this.config.SUPABASE_PUBLISHABLE_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      },
    );
    if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
      throw authError("invalid_credentials", 401);
    }

    const userId = String(payload?.user?.id || "");
    if (!userId) throw authError("service_unavailable", 503);
    const profiles = await this.serviceRequest(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`
      + "&select=id,public_uid,display_name,role,account_status&limit=1",
    );
    const profile = profiles?.[0];
    if (!profile) throw authError("service_unavailable", 503);
    if (profile.account_status === "banned") {
      throw authError("account_banned", 403);
    }

    return {
      access_token: String(payload.access_token),
      refresh_token: String(payload.refresh_token),
      expires_in: Number(payload.expires_in || 0),
      token_type: String(payload.token_type || "bearer"),
      user: {
        id: String(profile.id),
        public_uid: profile.public_uid == null
          ? null
          : validateUid(profile.public_uid),
        display_name: String(profile.display_name || ""),
        role: String(profile.role || "user"),
      },
    };
  }
}

import { randomUUID } from "node:crypto";
import type { GatewayConfig } from "../config.ts";
import { normalizeDirectoryResource } from "../directory/external-directory.ts";
import { encryptSecret } from "../secrets/crypto.ts";
import { validateProviderUrl, validateUserProviderUrl } from "../security/provider-url.ts";
import type { GatewayApi, GatewayUser } from "../server.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = String(input[key] ?? "").trim();
  if (!value) throw Object.assign(new Error(`${key} is required`), { statusCode: 400 });
  return value;
}

function optionalNumber(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = input[key] === undefined ? fallback : Number(input[key]);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw Object.assign(new Error(`${key} is invalid`), { statusCode: 400 });
  }
  return value;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupabaseGatewayApi implements GatewayApi {
  private readonly database: SupabaseRest;
  constructor(privateConfig: GatewayConfig) {
    this.config = privateConfig;
    this.database = new SupabaseRest(privateConfig);
  }
  private readonly config: GatewayConfig;

  async authorize(token: string): Promise<GatewayUser | null> {
    const user = await this.database.userForJwt(token);
    if (!user) return null;
    const rows = await this.database.request(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,account_status&limit=1`,
    );
    const profile = rows?.[0];
    return profile && profile.account_status !== "banned"
      ? { id: profile.id, role: profile.role ?? "user" }
      : null;
  }

  async listDirectoryResources(includeInactive = false): Promise<unknown[]> {
    const visibility = includeInactive ? "" : "&active=eq.true";
    return await this.database.request(
      `/rest/v1/external_recommendations?select=id,platform,name,description,url,avatar_url,active,sort_order,verified_at,created_at,updated_at&order=sort_order.asc,created_at.asc${visibility}`,
    );
  }

  async createDirectoryResource(
    input: Record<string, unknown>,
    actor: GatewayUser,
  ): Promise<unknown> {
    const normalized = await normalizeDirectoryResource(input);
    try {
      const rows = await this.database.request("/rest/v1/external_recommendations", {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: {
          ...normalized,
          verified_at: new Date().toISOString(),
          created_by: actor.id,
        },
      });
      return rows[0];
    } catch (error) {
      throw Object.assign(new Error("directory_failed"), {
        statusCode: Number((error as { status?: number })?.status || 500),
      });
    }
  }

  async updateDirectoryResource(
    resourceId: string,
    input: Record<string, unknown>,
    _actor: GatewayUser,
  ): Promise<unknown> {
    const existing = await this.database.request(
      `/rest/v1/external_recommendations?id=eq.${encodeURIComponent(resourceId)}&select=platform,name,description,url,avatar_url,active,sort_order&limit=1`,
    );
    if (!existing.length) {
      throw Object.assign(new Error("resource_not_found"), { statusCode: 404 });
    }
    const normalized = await normalizeDirectoryResource({
      ...existing[0],
      ...input,
    });
    try {
      const rows = await this.database.request(
        `/rest/v1/external_recommendations?id=eq.${encodeURIComponent(resourceId)}`,
        {
          method: "PATCH",
          headers: { prefer: "return=representation" },
          body: {
            ...normalized,
            verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      );
      return rows[0];
    } catch (error) {
      throw Object.assign(new Error("directory_failed"), {
        statusCode: Number((error as { status?: number })?.status || 500),
      });
    }
  }

  async deleteDirectoryResource(
    resourceId: string,
    _actor: GatewayUser,
  ): Promise<void> {
    const rows = await this.database.request(
      `/rest/v1/external_recommendations?id=eq.${encodeURIComponent(resourceId)}&select=id&limit=1`,
    );
    if (!rows.length) {
      throw Object.assign(new Error("resource_not_found"), { statusCode: 404 });
    }
    await this.database.request(
      `/rest/v1/external_recommendations?id=eq.${encodeURIComponent(resourceId)}`,
      { method: "DELETE" },
    );
  }

  async deleteOwnPost(postId: string, actor: GatewayUser): Promise<string[]> {
    if (!UUID_PATTERN.test(postId)) {
      throw Object.assign(new Error("invalid_post_id"), { statusCode: 400 });
    }
    const encodedPostId = encodeURIComponent(postId);
    const encodedActorId = encodeURIComponent(actor.id);
    const posts = await this.database.request(
      `/rest/v1/posts?id=eq.${encodedPostId}&author_id=eq.${encodedActorId}&select=id&limit=1`,
    );
    if (!posts.length) return [];

    const images = await this.database.request(
      `/rest/v1/post_images?post_id=eq.${encodedPostId}&owner_id=eq.${encodedActorId}&select=storage_path&order=sort_order.asc`,
    );
    const deleted = await this.database.request(
      `/rest/v1/posts?id=eq.${encodedPostId}&author_id=eq.${encodedActorId}&select=id`,
      { method: "DELETE", headers: { prefer: "return=representation" } },
    );
    if (!Array.isArray(deleted) || deleted.length !== 1) {
      throw Object.assign(new Error("post_delete_failed"), { statusCode: 409 });
    }
    return images
      .map((image: { storage_path?: unknown }) => String(image.storage_path || ""))
      .filter((path: string) => path.startsWith(`${actor.id}/${postId}/`));
  }

  async dashboard(): Promise<Record<string, unknown>> {
    const today = new Date().toISOString().slice(0, 10);
    const jobs = await this.database.request(
      `/rest/v1/ai_jobs?created_at=gte.${today}T00:00:00Z&select=status`,
    );
    const usage = await this.database.request(
      `/rest/v1/ai_usage_ledger?created_at=gte.${today}T00:00:00Z&select=input_tokens,output_tokens,cost_amount`,
    );
    const reviews = await this.database.request(
      "/rest/v1/review_decisions?status=in.(draft,ai_reviewed,human_approved)&select=id",
    );
    return {
      calls_today: jobs.length,
      tokens_today: usage.reduce(
        (sum: number, item: any) => sum + Number(item.input_tokens) + Number(item.output_tokens),
        0,
      ),
      cost_today: usage.reduce((sum: number, item: any) => sum + Number(item.cost_amount), 0),
      failed_today: jobs.filter((item: any) => item.status === "failed").length,
      review_queue: reviews.length,
    };
  }

  async listProviders(): Promise<unknown[]> {
    const providers = await this.database.request(
      "/rest/v1/ai_providers?select=id,name,adapter,base_url,enabled,updated_at&order=created_at.asc",
    );
    const secrets = await this.database.request(
      "/rest/v1/ai_provider_secrets?active=eq.true&select=provider_id,last_four,key_version,created_at",
    );
    const secretByProvider = new Map(secrets.map((item: any) => [item.provider_id, item]));
    return providers.map((provider: any) => {
      const secret = secretByProvider.get(provider.id) as any;
      return {
        ...provider,
        last_four: secret?.last_four ?? "",
        key_version: secret?.key_version ?? null,
      };
    });
  }

  async createProvider(input: Record<string, unknown>, actor: GatewayUser): Promise<unknown> {
    const name = requiredString(input, "name");
    const adapter = requiredString(input, "adapter");
    const baseUrl = requiredString(input, "base_url");
    const apiKey = requiredString(input, "api_key");
    if (!["openai_compatible", "anthropic", "gemini"].includes(adapter)) {
      throw Object.assign(new Error("unsupported adapter"), { statusCode: 400 });
    }
    validateProviderUrl(
      baseUrl,
      this.config.ALLOWED_PROVIDER_HOSTS,
      this.config.ALLOWED_LOCAL_PROVIDER_HOSTS,
    );
    const providerRows = await this.database.request("/rest/v1/ai_providers", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: {
        name,
        adapter,
        base_url: baseUrl,
        created_by: actor.id,
      },
    });
    const provider = providerRows[0];
    const encrypted = encryptSecret(apiKey, this.config.AI_SECRET_MASTER_KEY, 1);
    try {
      await this.database.request("/rest/v1/ai_provider_secrets", {
        method: "POST",
        body: {
          provider_id: provider.id,
          ...encrypted,
        },
      });
    } catch (error) {
      await this.database.request(
        `/rest/v1/ai_providers?id=eq.${encodeURIComponent(provider.id)}`,
        { method: "DELETE" },
      ).catch(() => undefined);
      throw error;
    }
    return {
      id: provider.id,
      name: provider.name,
      adapter: provider.adapter,
      base_url: provider.base_url,
      enabled: provider.enabled,
      last_four: encrypted.last_four,
    };
  }

  async listUserConnections(ownerId: string): Promise<unknown[]> {
    const connections = await this.database.request(
      `/rest/v1/user_ai_connections?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,label,adapter,base_url,model_name,max_output_tokens,context_tokens,temperature,timeout_ms,enabled,is_default,created_at,updated_at&order=is_default.desc,created_at.desc`,
    );
    const secrets = await this.database.request(
      `/rest/v1/user_ai_connection_secrets?owner_id=eq.${encodeURIComponent(ownerId)}&active=eq.true&select=connection_id,last_four,key_version,created_at`,
    );
    const secretByConnection = new Map(
      secrets.map((item: any) => [item.connection_id, item]),
    );
    return connections.map((connection: any) => {
      const secret = secretByConnection.get(connection.id) as any;
      return {
        ...connection,
        secret_mask: secret?.last_four ? `••••${secret.last_four}` : "未设置",
        key_version: secret?.key_version ?? null,
      };
    });
  }

  async createUserConnection(
    ownerId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const label = requiredString(input, "label");
    const adapter = requiredString(input, "adapter");
    const baseUrl = requiredString(input, "base_url");
    const modelName = requiredString(input, "model_name");
    const apiKey = requiredString(input, "api_key");
    if (!["openai_compatible", "anthropic", "gemini"].includes(adapter)) {
      throw Object.assign(new Error("unsupported adapter"), { statusCode: 400 });
    }
    try {
      validateUserProviderUrl(baseUrl, this.config.ALLOWED_LOCAL_PROVIDER_HOSTS);
    } catch (error) {
      throw Object.assign(error as Error, { statusCode: 400 });
    }
    const existing = await this.database.request(
      `/rest/v1/user_ai_connections?owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`,
    );
    const shouldDefault = !existing.length || input.is_default === true;
    const connectionRows = await this.database.request("/rest/v1/user_ai_connections", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: {
        owner_id: ownerId,
        label,
        adapter,
        base_url: baseUrl,
        model_name: modelName,
        max_output_tokens: optionalNumber(input, "max_output_tokens", 4096, 1, 262144),
        context_tokens: optionalNumber(input, "context_tokens", 32768, 1, 4000000),
        temperature: optionalNumber(input, "temperature", 0.2, 0, 2),
        timeout_ms: optionalNumber(input, "timeout_ms", 60000, 1000, 600000),
        is_default: !existing.length,
      },
    });
    const connection = connectionRows[0];
    const encrypted = encryptSecret(apiKey, this.config.AI_SECRET_MASTER_KEY, 1);
    try {
      await this.database.request("/rest/v1/user_ai_connection_secrets", {
        method: "POST",
        body: {
          connection_id: connection.id,
          owner_id: ownerId,
          ...encrypted,
        },
      });
      if (shouldDefault) {
        await this.database.request("/rest/v1/rpc/set_default_user_ai_connection", {
          method: "POST",
          body: { p_owner_id: ownerId, p_connection_id: connection.id },
        });
      }
    } catch (error) {
      await this.database.request(
        `/rest/v1/user_ai_connections?id=eq.${encodeURIComponent(connection.id)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
        { method: "DELETE" },
      ).catch(() => undefined);
      throw error;
    }
    const refreshed = await this.listUserConnections(ownerId);
    return (refreshed as any[]).find((item) => item.id === connection.id);
  }

  async setDefaultUserConnection(ownerId: string, connectionId: string): Promise<unknown> {
    await this.database.request("/rest/v1/rpc/set_default_user_ai_connection", {
      method: "POST",
      body: { p_owner_id: ownerId, p_connection_id: connectionId },
    });
    const rows = await this.listUserConnections(ownerId);
    const connection = (rows as any[]).find((item) => item.id === connectionId);
    if (!connection) throw Object.assign(new Error("connection not found"), { statusCode: 404 });
    return connection;
  }

  async rotateUserConnectionSecret(
    ownerId: string,
    connectionId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const apiKey = requiredString(input, "api_key");
    const rows = await this.database.request(
      `/rest/v1/user_ai_connections?id=eq.${encodeURIComponent(connectionId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`,
    );
    if (!rows.length) throw Object.assign(new Error("connection not found"), { statusCode: 404 });
    const previous = await this.database.request(
      `/rest/v1/user_ai_connection_secrets?connection_id=eq.${encodeURIComponent(connectionId)}&owner_id=eq.${encodeURIComponent(ownerId)}&active=eq.true&select=key_version`,
    );
    const keyVersion = Number(previous[0]?.key_version ?? 0) + 1;
    const encrypted = encryptSecret(apiKey, this.config.AI_SECRET_MASTER_KEY, keyVersion);
    await this.database.request("/rest/v1/rpc/rotate_user_ai_connection_secret", {
      method: "POST",
      body: {
        p_owner_id: ownerId,
        p_connection_id: connectionId,
        p_ciphertext: encrypted.ciphertext,
        p_iv: encrypted.iv,
        p_auth_tag: encrypted.auth_tag,
        p_key_version: encrypted.key_version,
        p_last_four: encrypted.last_four,
      },
    });
    const connections = await this.listUserConnections(ownerId);
    return (connections as any[]).find((item) => item.id === connectionId);
  }

  async enqueueJob(
    ownerId: string,
    analysisId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const analysisRows = await this.database.request(
      `/rest/v1/workbench_analyses?id=eq.${encodeURIComponent(analysisId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`,
    );
    if (!analysisRows.length) throw Object.assign(new Error("analysis not found"), { statusCode: 404 });
    const connections = await this.database.request(
      `/rest/v1/user_ai_connections?owner_id=eq.${encodeURIComponent(ownerId)}&enabled=eq.true&is_default=eq.true&select=id,label,adapter,base_url,model_name,max_output_tokens,context_tokens,temperature,timeout_ms&limit=1`,
    );
    if (!connections.length) {
      throw Object.assign(new Error("ai_connection_required"), { statusCode: 409 });
    }
    const taskType = String(input.task_type || "wave_analysis");
    const rows = await this.database.request("/rest/v1/ai_jobs", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: {
        owner_id: ownerId,
        analysis_id: analysisId,
        user_connection_id: connections[0].id,
        connection_snapshot: {
          id: connections[0].id,
          label: connections[0].label,
          adapter: connections[0].adapter,
          base_url: connections[0].base_url,
          model_name: connections[0].model_name,
          max_output_tokens: connections[0].max_output_tokens,
          context_tokens: connections[0].context_tokens,
          temperature: connections[0].temperature,
          timeout_ms: connections[0].timeout_ms,
        },
        task_type: taskType,
        idempotency_key: `${ownerId}:${analysisId}:${taskType}:${randomUUID()}`,
        input_payload: input,
      },
    });
    return rows[0];
  }

  async getJob(ownerId: string, jobId: string): Promise<unknown> {
    const rows = await this.database.request(
      `/rest/v1/ai_jobs?id=eq.${encodeURIComponent(jobId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id,status,output_payload,error_code,error_message,actual_model_id,user_connection_id,connection_snapshot,knowledge_version,created_at,finished_at&limit=1`,
    );
    if (!rows.length) throw Object.assign(new Error("job not found"), { statusCode: 404 });
    return rows[0];
  }
}

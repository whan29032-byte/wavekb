import type { GatewayConfig } from "../config.ts";
import { createProvider, type Adapter } from "../providers/registry.ts";
import { validateProviderUrl } from "../security/provider-url.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";
import { decryptSecret, type EncryptedSecret } from "./crypto.ts";
import type { ResolvedUserConnection } from "./user-connection.ts";

type Database = Pick<SupabaseRest, "request">;
export type ManagedModel = {
  id: string; provider_id: string; name: string; timeout_ms: number;
  max_output_tokens: number; context_tokens: number; temperature: number;
  provider: { id: string; adapter: Adapter; base_url: string };
};
const unavailable = () => Object.assign(new Error("managed_ai_not_configured"), { statusCode: 503 });

// Availability reads metadata and secret existence only. It never decrypts a
// key or calls a provider; the worker resolves the key just before execution.
export class ManagedConnectionResolver {
  private readonly database: Database;
  private readonly config: GatewayConfig;
  constructor(config: GatewayConfig, database?: Database) {
    this.config = config;
    this.database = database ?? new SupabaseRest(config);
  }
  async inspect(taskType: string, expectedModelId?: string): Promise<ManagedModel> {
    if (!this.config.MEMBERSHIP_MANAGED_AI_ENABLED) throw unavailable();
    const routes = await this.database.request(`/rest/v1/ai_task_routes?task_type=eq.${encodeURIComponent(taskType)}&enabled=eq.true&select=primary_model_id&limit=1`);
    const modelId = routes?.[0]?.primary_model_id;
    if (!modelId || (expectedModelId && expectedModelId !== modelId)) throw unavailable();
    const models = await this.database.request(`/rest/v1/ai_models?id=eq.${encodeURIComponent(modelId)}&enabled=eq.true&select=id,provider_id,name,timeout_ms,max_output_tokens,context_tokens,temperature&limit=1`);
    const model = models?.[0];
    if (!model || !model.name || !Number.isInteger(Number(model.timeout_ms)) || Number(model.timeout_ms) < 1000
      || !Number.isInteger(Number(model.max_output_tokens)) || Number(model.max_output_tokens) < 1
      || !Number.isInteger(Number(model.context_tokens)) || Number(model.context_tokens) < 1
      || !Number.isFinite(Number(model.temperature)) || Number(model.temperature) < 0 || Number(model.temperature) > 2) throw unavailable();
    const providers = await this.database.request(`/rest/v1/ai_providers?id=eq.${encodeURIComponent(model.provider_id)}&enabled=eq.true&select=id,adapter,base_url&limit=1`);
    const provider = providers?.[0];
    if (!provider || !["openai_compatible", "anthropic", "gemini"].includes(provider.adapter)) throw unavailable();
    try { validateProviderUrl(provider.base_url, this.config.ALLOWED_PROVIDER_HOSTS, this.config.ALLOWED_LOCAL_PROVIDER_HOSTS); }
    catch { throw unavailable(); }
    const secrets = await this.database.request(`/rest/v1/ai_provider_secrets?provider_id=eq.${encodeURIComponent(provider.id)}&active=eq.true&select=id&limit=1`);
    if (!secrets?.length) throw unavailable();
    return { ...model, provider } as ManagedModel;
  }
  async resolve(ownerId: string, taskType: string, modelId: string): Promise<ResolvedUserConnection> {
    const model = await this.inspect(taskType, modelId);
    const secrets = await this.database.request(`/rest/v1/ai_provider_secrets?provider_id=eq.${encodeURIComponent(model.provider_id)}&active=eq.true&select=ciphertext,iv,auth_tag,key_version,last_four&limit=1`);
    if (!secrets?.length) throw unavailable();
    let apiKey: string;
    try { apiKey = decryptSecret(secrets[0] as EncryptedSecret, this.config.AI_SECRET_MASTER_KEY); }
    catch { throw unavailable(); }
    return {
      id: model.id, ownerId, modelName: model.name, timeoutMs: Number(model.timeout_ms),
      maxOutputTokens: Number(model.max_output_tokens), contextTokens: Number(model.context_tokens), temperature: Number(model.temperature),
      provider: createProvider(model.provider.adapter, {
        baseUrl: model.provider.base_url, apiKey,
        allowedPublicHosts: this.config.ALLOWED_PROVIDER_HOSTS,
        allowedLocalHosts: this.config.ALLOWED_LOCAL_PROVIDER_HOSTS,
      }),
    };
  }
}

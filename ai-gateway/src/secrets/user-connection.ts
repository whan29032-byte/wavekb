import type { GatewayConfig } from "../config.ts";
import { createProvider, type Adapter } from "../providers/registry.ts";
import type { ModelProvider } from "../providers/types.ts";
import { SupabaseRest } from "../storage/supabase-rest.ts";
import { decryptSecret, type EncryptedSecret } from "./crypto.ts";

export type ResolvedUserConnection = {
  id: string;
  ownerId: string;
  modelName: string;
  timeoutMs: number;
  provider: ModelProvider;
};

export class UserConnectionResolver {
  private readonly database: SupabaseRest;

  constructor(private readonly config: GatewayConfig) {
    this.database = new SupabaseRest(config);
  }

  async resolve(ownerId: string, connectionId: string): Promise<ResolvedUserConnection> {
    const connections = await this.database.request(
      `/rest/v1/user_ai_connections?id=eq.${encodeURIComponent(connectionId)}&owner_id=eq.${encodeURIComponent(ownerId)}&enabled=eq.true&select=id,owner_id,adapter,base_url,model_name,timeout_ms&limit=1`,
    );
    if (!connections.length) throw new Error("user connection not found");
    const connection = connections[0];
    const secrets = await this.database.request(
      `/rest/v1/user_ai_connection_secrets?connection_id=eq.${encodeURIComponent(connectionId)}&owner_id=eq.${encodeURIComponent(ownerId)}&active=eq.true&select=ciphertext,iv,auth_tag,key_version,last_four&limit=1`,
    );
    if (!secrets.length) throw new Error("active user connection secret not found");
    const apiKey = decryptSecret(secrets[0] as EncryptedSecret, this.config.AI_SECRET_MASTER_KEY);
    const providerUrl = new URL(connection.base_url);
    return {
      id: connection.id,
      ownerId: connection.owner_id,
      modelName: connection.model_name,
      timeoutMs: Number(connection.timeout_ms),
      provider: createProvider(connection.adapter as Adapter, {
        baseUrl: connection.base_url,
        apiKey,
        allowedPublicHosts: [providerUrl.hostname],
        allowedLocalHosts: this.config.ALLOWED_LOCAL_PROVIDER_HOSTS,
      }),
    };
  }
}

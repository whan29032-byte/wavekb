import { decryptSecret, encryptSecret, type EncryptedSecret } from "./crypto.ts";

export type SecretRecord = EncryptedSecret & {
  provider_id: string;
  active: boolean;
  updated_at: string;
};

export class SecretStore {
  readonly records = new Map<string, SecretRecord>();
  private readonly masterKey: Buffer;
  private readonly now: () => Date;
  constructor(masterKey: Buffer, now = () => new Date()) {
    this.masterKey = masterKey;
    this.now = now;
  }

  view(providerId: string): Pick<SecretRecord, "last_four" | "key_version" | "updated_at"> | null {
    const item = this.records.get(providerId);
    if (!item) return null;
    return {
      last_four: item.last_four,
      key_version: item.key_version,
      updated_at: item.updated_at,
    };
  }

  revealForServer(providerId: string): string {
    const item = this.records.get(providerId);
    if (!item?.active) throw new Error("active provider secret not found");
    return decryptSecret(item, this.masterKey);
  }

  async rotate(providerId: string, plain: string, testConnection: (secret: string) => Promise<void>): Promise<void> {
    await testConnection(plain);
    const previous = this.records.get(providerId);
    const encrypted = encryptSecret(plain, this.masterKey, (previous?.key_version ?? 0) + 1);
    this.records.set(providerId, {
      ...encrypted,
      provider_id: providerId,
      active: true,
      updated_at: this.now().toISOString(),
    });
  }
}

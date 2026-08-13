import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: number;
  last_four: string;
};

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
}

export function encryptSecret(plain: string, key: Buffer, keyVersion: number): EncryptedSecret {
  assertKey(key);
  if (!plain) throw new Error("secret cannot be empty");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    key_version: keyVersion,
    last_four: plain.slice(-4),
  };
}

export function decryptSecret(encrypted: EncryptedSecret, key: Buffer): string {
  assertKey(key);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

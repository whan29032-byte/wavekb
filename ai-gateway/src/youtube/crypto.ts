import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { YouTubeSecret } from "./contracts.ts";

function aad(ownerId: string, channelId: string) { return Buffer.from(JSON.stringify(["wavekb-youtube-v1", ownerId, channelId])); }
export function encryptYouTubeSecret(value: string, key: Buffer, ownerId: string, channelId: string): YouTubeSecret {
  if (key.length !== 32 || !value) throw new Error("youtube_secret_invalid");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(ownerId, channelId));
  return { ciphertext: Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("base64"), iv: iv.toString("base64"), auth_tag: cipher.getAuthTag().toString("base64"), key_version: 1 };
}
export function decryptYouTubeSecret(secret: YouTubeSecret, key: Buffer, ownerId: string, channelId: string): string {
  if (key.length !== 32 || secret.key_version !== 1) throw new Error("youtube_secret_invalid");
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  cipher.setAAD(aad(ownerId, channelId));
  cipher.setAuthTag(Buffer.from(secret.auth_tag, "base64"));
  return Buffer.concat([cipher.update(Buffer.from(secret.ciphertext, "base64")), cipher.final()]).toString("utf8");
}

import { createHash, timingSafeEqual } from "node:crypto";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const doubleSha256 = (input: Uint8Array) => createHash("sha256").update(createHash("sha256").update(input).digest()).digest();

export function tronAddressToHex(address: string): string {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error("membership_wallet_address_invalid");
  let value = 0n;
  for (const character of address) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw new Error("membership_wallet_address_invalid");
    value = value * 58n + BigInt(digit);
  }
  const encoded = value.toString(16).padStart(50, "0");
  if (encoded.length !== 50) throw new Error("membership_wallet_address_invalid");
  const bytes = Buffer.from(encoded, "hex"), payload = bytes.subarray(0, 21);
  if (payload[0] !== 0x41 || !timingSafeEqual(bytes.subarray(21), doubleSha256(payload).subarray(0, 4))) throw new Error("membership_wallet_address_invalid");
  return payload.toString("hex");
}
export function tronHexToAddress(hex: string): string {
  if (!/^41[0-9a-f]{40}$/i.test(hex)) throw new Error("membership_wallet_address_invalid");
  const payload = Buffer.from(hex, "hex"), bytes = Buffer.concat([payload, doubleSha256(payload).subarray(0, 4)]);
  let value = BigInt(`0x${bytes.toString("hex")}`), encoded = "";
  while (value > 0n) { encoded = BASE58[Number(value % 58n)]! + encoded; value /= 58n; }
  return encoded;
}
export function evmAddress(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/i.test(value) || /^0x0{40}$/i.test(value)) throw new Error("membership_wallet_address_invalid");
  return value.toLowerCase();
}

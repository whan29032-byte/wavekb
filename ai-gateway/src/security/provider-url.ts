import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^192\.0\.0\./,
  /^192\.0\.2\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
];

type ResolveAll = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;

function bareHostname(value: string): string {
  return value.replace(/^\[|\]$/g, "").toLowerCase();
}

function isPublicIp(value: string): boolean {
  const address = bareHostname(value);
  if (isIP(address) === 4) {
    return !PRIVATE_IPV4.some((pattern) => pattern.test(address))
      && address !== "0.0.0.0"
      && !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)
      && !/^198\.(1[89])\./.test(address)
      && !/^22[4-9]\.|^23\d\./.test(address);
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return false;
    if (/^(fc|fd)/.test(normalized) || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) return false;
    if (normalized.startsWith("2001:db8:")) return false;
    if (normalized.startsWith("::ffff:")) return isPublicIp(normalized.slice(7));
    return true;
  }
  return false;
}

export async function assertSafeProviderDestination(
  url: URL,
  allowedLocalHosts: string[] = [],
  resolve: ResolveAll = lookup,
): Promise<string | null> {
  const hostname = bareHostname(url.hostname);
  const host = url.host.toLowerCase();
  if (LOOPBACK.has(hostname) && allowedLocalHosts.map((item) => item.toLowerCase()).includes(host)) {
    return isIP(hostname) ? hostname : null;
  }
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error("private provider hosts are blocked");
    return hostname;
  }
  if (!hostname.includes(".") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("private provider hosts are blocked");
  }
  const addresses = await resolve(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !isPublicIp(item.address))) {
    throw new Error("provider DNS must resolve only to public addresses");
  }
  return addresses[0]?.address ?? null;
}

export function validateProviderUrl(
  value: string,
  allowedPublicHosts: string[],
  allowedLocalHosts: string[],
): URL {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("provider URL cannot contain credentials");
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  if (LOOPBACK.has(hostname)) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported local provider protocol");
    }
    if (!allowedLocalHosts.map((item) => item.toLowerCase()).includes(host)) {
      throw new Error("local provider is not allowlisted");
    }
    return url;
  }
  if (url.protocol !== "https:") throw new Error("public providers require HTTPS");
  if (!allowedPublicHosts.map((item) => item.toLowerCase()).includes(hostname)) {
    throw new Error("provider host is not allowlisted");
  }
  return url;
}

export function validateUserProviderUrl(
  value: string,
  allowedLocalHosts: string[],
): URL {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("provider URL cannot contain credentials");
  const host = url.host.toLowerCase();
  const hostname = bareHostname(url.hostname);
  if (LOOPBACK.has(hostname)) {
    if (!allowedLocalHosts.map((item) => item.toLowerCase()).includes(host)) {
      throw new Error("local provider is not allowlisted by the site operator");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("unsupported local provider protocol");
    }
    return url;
  }
  if (url.protocol !== "https:") throw new Error("public providers require HTTPS");
  if (
    (isIP(hostname) !== 0 && !isPublicIp(hostname))
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
  ) {
    throw new Error("private provider hosts are blocked");
  }
  return url;
}

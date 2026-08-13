const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

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
  const hostname = url.hostname.toLowerCase();
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
    PRIVATE_IPV4.some((pattern) => pattern.test(hostname))
    || hostname === "0.0.0.0"
    || hostname.endsWith(".local")
  ) {
    throw new Error("private provider hosts are blocked");
  }
  return url;
}

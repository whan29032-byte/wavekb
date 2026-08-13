function normalizedOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null) {
  return value?.split(',', 1)[0]?.trim() || null;
}

export function gatewayRequestOrigin(
  headers: Headers,
  fallbackOrigin: string,
  configuredOrigin = process.env.AUTH_GATEWAY_PUBLIC_ORIGIN,
) {
  const fetchSite = headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return null;

  const fallback = normalizedOrigin(fallbackOrigin);
  if (!fallback) return null;

  const forwardedHost = firstHeaderValue(headers.get('x-forwarded-host'));
  const host = forwardedHost || firstHeaderValue(headers.get('host'));
  const forwardedProtocol = firstHeaderValue(headers.get('x-forwarded-proto'));
  const protocol = forwardedProtocol || new URL(fallback).protocol.replace(/:$/, '');
  const publicRequestOrigin = host ? normalizedOrigin(`${protocol}://${host}`) : fallback;
  const browserOrigin = normalizedOrigin(headers.get('origin'));

  if (!publicRequestOrigin || (browserOrigin && browserOrigin !== publicRequestOrigin)) return null;
  if (headers.get('origin') && !browserOrigin) return null;

  if (!configuredOrigin?.trim()) return publicRequestOrigin;
  return normalizedOrigin(configuredOrigin);
}

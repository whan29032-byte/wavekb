import { validateProviderUrl } from "../security/provider-url.ts";
import type { ProviderConfig } from "./types.ts";

export function endpoint(config: ProviderConfig, path: string): URL {
  const base = validateProviderUrl(
    config.baseUrl,
    config.allowedPublicHosts ?? [],
    config.allowedLocalHosts ?? [],
  );
  const normalized = base.pathname.endsWith("/v1") && path.startsWith("/v1/")
    ? path.slice(3)
    : path;
  return new URL(`${base.toString().replace(/\/$/, "")}${normalized}`);
}

export async function postJson(
  url: URL,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Object.assign(new Error(`provider request failed: ${response.status}`), {
      status: response.status,
      code: response.status === 401 || response.status === 403
        ? "AUTH"
        : response.status === 429
          ? "RATE_LIMIT"
          : response.status >= 500
            ? "UPSTREAM"
            : "REQUEST",
    });
    throw error;
  }
  return payload;
}

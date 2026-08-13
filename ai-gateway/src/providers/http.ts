import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { validateProviderUrl } from "../security/provider-url.ts";
import { assertSafeProviderDestination } from "../security/provider-url.ts";
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
  allowedLocalHosts: string[] = [],
): Promise<any> {
  const pinnedAddress = await assertSafeProviderDestination(url, allowedLocalHosts);
  const rawBody = JSON.stringify(body);
  const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(rawBody).toString(),
        ...headers,
      },
      ...(pinnedAddress ? {
        lookup: (_hostname, _options, callback) => callback(null, pinnedAddress, isIP(pinnedAddress)),
      } : {}),
    }, (incoming) => {
      const chunks: Buffer[] = [];
      let length = 0;
      incoming.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 5 * 1024 * 1024) request.destroy(Object.assign(new Error("provider response is too large"), { code: "UPSTREAM" }));
        else chunks.push(chunk);
      });
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 500, text: Buffer.concat(chunks).toString("utf8") }));
    });
    const timer = setTimeout(() => request.destroy(Object.assign(new Error("provider request timed out"), { code: "TIMEOUT" })), timeoutMs);
    request.once("close", () => clearTimeout(timer));
    request.once("error", reject);
    request.end(rawBody);
  });
  if (response.status >= 300 && response.status < 400) {
    throw Object.assign(new Error("provider redirects are not allowed"), { status: response.status, code: "REQUEST" });
  }
  let payload: any = {};
  try { payload = response.text ? JSON.parse(response.text) : {}; } catch { payload = {}; }
  if (response.status < 200 || response.status >= 300) {
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

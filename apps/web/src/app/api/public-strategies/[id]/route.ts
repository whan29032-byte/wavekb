import { PUBLIC_STRATEGY_MAX_BYTES } from "@wavekb/domain/trading-review";
import { isPublicStrategySnapshot, strategySnapshotIdPattern } from "@/lib/trading/public-strategy-contract";

const cacheControl = "public, max-age=0, must-revalidate";
const digestTag = /^"[0-9a-f]{64}"$/;
const maximumResponseBytes = PUBLIC_STRATEGY_MAX_BYTES + 1_024;

function failure(status: number, error = "strategy_snapshot_unavailable", headers?: HeadersInit) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } });
}

function conditionalTags(header: string | null) {
  if (!header || header.length > 550) return [];
  const tags = header.split(",").map((tag) => tag.trim());
  if (tags.length === 1 && tags[0] === "*") return tags;
  return tags.every((tag) => digestTag.test(tag.replace(/^W\//, ""))) ? tags : [];
}

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!strategySnapshotIdPattern.test(id) || new URL(request.url).search) return failure(404, "not_found");
  const tags = conditionalTags(request.headers.get("if-none-match"));
  const origin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

  let upstream: Response;
  try {
    upstream = await fetch(`${origin}/v1/public/strategy-snapshots/${id}`, {
      method: "GET", cache: "no-store", credentials: "omit", redirect: "error",
      headers: { accept: "application/json", ...(tags.length ? { "if-none-match": tags.join(", ") } : {}) },
    });
  } catch {
    return failure(503);
  }

  if (upstream.status === 404) return failure(404, "not_found");
  if (upstream.status === 503) return failure(503);
  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get("retry-after");
    return failure(429, "rate_limited", retryAfter && /^\d{1,6}$/.test(retryAfter) ? { "retry-after": retryAfter } : undefined);
  }

  const etag = upstream.headers.get("etag") ?? "";
  if (upstream.status === 304 && digestTag.test(etag) && tags.some((tag) => tag === "*" || tag.replace(/^W\//, "") === etag)) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": cacheControl } });
  }
  if (upstream.status !== 200) return failure(502);
  if (Number(upstream.headers.get("content-length")) > maximumResponseBytes) return failure(502);

  try {
    const body = await upstream.text();
    if (Buffer.byteLength(body, "utf8") > maximumResponseBytes) return failure(502);
    const payload: unknown = JSON.parse(body);
    if (!isPublicStrategySnapshot(payload) || payload.id.toLowerCase() !== id.toLowerCase()
      || etag !== `"${payload.projection_digest}"`) return failure(502);
    return Response.json(payload, { headers: { etag, "cache-control": cacheControl } });
  } catch {
    return failure(502);
  }
}

import "server-only";

import type { CommunityPost } from "@wavekb/domain";
import { PUBLIC_STRATEGY_MAX_BYTES, type PublicStrategySnapshot } from "@wavekb/domain/trading-review";
import { isPublicStrategySnapshot, strategySnapshotIdPattern } from "@/lib/trading/public-strategy-contract";

export async function publicStrategyForPost(
  post: Pick<CommunityPost, "status" | "id" | "chart_package">,
  fetcher: typeof fetch = fetch,
): Promise<PublicStrategySnapshot | null> {
  const pointer = post.chart_package;
  const id = pointer?.snapshot_id;
  if (post.status !== "published" || pointer?.provider !== "wavekb-trade-snapshot"
    || typeof id !== "string" || !strategySnapshotIdPattern.test(id)) return null;
  const origin = (process.env.AUTH_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  try {
    const response = await fetcher(`${origin}/v1/public/strategy-snapshots/${id}`, {
      cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(5_000),
      headers: { accept: "application/json" },
    });
    const maxBytes = PUBLIC_STRATEGY_MAX_BYTES + 1_024;
    if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) return null;
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maxBytes) return null;
    const snapshot: unknown = JSON.parse(body);
    return isPublicStrategySnapshot(snapshot) && snapshot.post_id === post.id && snapshot.id === id ? snapshot : null;
  } catch {
    return null;
  }
}

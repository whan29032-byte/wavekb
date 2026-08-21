import { parseExternalReference, type ExternalReference } from "@wavekb/domain";

export type YouTubeMedia = ExternalReference & { kind: "youtube"; videoId: string; embedUrl: string };
export type XMedia = ExternalReference & { kind: "x"; statusId: string };
export type ResearchMediaReference = YouTubeMedia | XMedia;

export function normalizeResearchMedia(reference: ExternalReference): ResearchMediaReference | null {
  const validation = parseExternalReference(reference.url);
  if (!validation.ok || validation.kind !== reference.kind) return null;
  const url = new URL(validation.url);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (reference.kind === "youtube") {
    const videoId = host === "youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : url.pathname === "/watch"
        ? url.searchParams.get("v") ?? ""
        : url.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/)?.[1] ?? "";
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(videoId)) return null;
    return {
      ...reference,
      url: validation.url,
      kind: "youtube",
      videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`,
    };
  }
  const statusId = url.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1] ?? "";
  if (!statusId) return null;
  return { ...reference, url: validation.url, kind: "x", statusId };
}

export function normalizeResearchMediaList(references: ExternalReference[]): ResearchMediaReference[] {
  return references
    .map(normalizeResearchMedia)
    .filter((reference): reference is ResearchMediaReference => Boolean(reference))
    .slice(0, 5);
}

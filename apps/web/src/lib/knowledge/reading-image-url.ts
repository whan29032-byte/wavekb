import images from "./generated-reading-images.json";

const deliveryImages: Record<string, string> = images;

/** Only known, source-verified knowledge scans have a lossless delivery copy. */
export function readingImageUrl(originalUrl: string): string | undefined {
  try {
    const parsed = new URL(originalUrl, "https://knowledge.invalid");
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.search || parsed.hash) return undefined;
    const optimized = deliveryImages[parsed.pathname];
    if (!optimized) return undefined;
    return /^https?:\/\//.test(originalUrl) ? new URL(optimized, parsed.origin).href : optimized;
  } catch {
    return undefined;
  }
}

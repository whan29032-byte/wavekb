import { describe, expect, it } from "vitest";
import { normalizeResearchMedia } from "./external-media";

describe("research media normalization", () => {
  it("converts supported YouTube URLs to privacy enhanced embeds", () => {
    expect(normalizeResearchMedia({ url: "https://youtube.com/shorts/abc12345", kind: "youtube", sort_order: 0 })).toMatchObject({
      videoId: "abc12345",
      embedUrl: "https://www.youtube-nocookie.com/embed/abc12345?rel=0",
    });
  });

  it("extracts only official X status identifiers", () => {
    expect(normalizeResearchMedia({ url: "https://x.com/wavekb/status/123456", kind: "x", sort_order: 0 })).toMatchObject({ statusId: "123456" });
    expect(normalizeResearchMedia({ url: "https://x.com/wavekb", kind: "x", sort_order: 0 })).toBeNull();
  });

  it("rejects a mismatched stored kind", () => {
    expect(normalizeResearchMedia({ url: "https://youtu.be/abc12345", kind: "x", sort_order: 0 })).toBeNull();
  });
});

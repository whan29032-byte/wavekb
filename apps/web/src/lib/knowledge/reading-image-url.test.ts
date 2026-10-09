import { describe, expect, it } from "vitest";
import { readingImageUrl } from "./reading-image-url";

describe("source-bound knowledge delivery URLs", () => {
  it("selects an immutable lossless copy without rewriting the original scan URL", () => {
    expect(readingImageUrl("/assets/figures-v10/page-043.png")).toMatch(/^\/assets\/reading-images\/[a-f0-9]{64}\.webp$/);
  });

  it("retains the configured public asset origin and does not optimize arbitrary uploads", () => {
    const local = readingImageUrl("/assets/figures-v10/page-043.png")!;
    expect(readingImageUrl("https://cdn.example.com/assets/figures-v10/page-043.png")).toBe(`https://cdn.example.com${local}`);
    for (const url of ["/uploads/user.png", "javascript:alert(1)", "/assets/figures-v10/page-043.png?v=changed", "/assets/figures-v10/page-043.png#changed"]) {
      expect(readingImageUrl(url)).toBeUndefined();
    }
  });
});

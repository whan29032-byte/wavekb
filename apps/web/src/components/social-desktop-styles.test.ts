import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("gives chat controls and the presence indicator actual two-dimensional sizes", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/components/social-desktop.module.css", "utf8");
  document.head.append(style);
  const host = document.createElement("div");
  host.innerHTML = '<button class="launcher"></button><div class="windowControls"><button></button></div><span class="presence"></span>';
  document.body.append(host);
  try {
    for (const [selector, size] of [[".launcher", "48px"], [".windowControls button", "32px"], [".presence", "8.8px"]]) {
      const computed = getComputedStyle(host.querySelector(selector)!);
      expect(computed.width).toBe(size); expect(computed.height).toBe(size);
    }
  } finally { host.remove(); style.remove(); }
});

import { afterEach, expect, it, vi } from "vitest";
import { APPEARANCE_BOOTSTRAP } from "./appearance-bootstrap";
import { applyAppearance, normalizeAppearance } from "./appearance";
import { installBrowserStorage } from "@/test/browser-storage";
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute("style"); });
it.each(["#000000", "#ffffff", "#557fb8", "#ff0000", "#ffff00"])("first paint matches hydrated colors for %s", (color) => {
  installBrowserStorage();
  const settings = normalizeAppearance({ theme: "custom", mode: "dark", customColor: color, reduceMotion: true });
  localStorage.setItem("wavekb:appearance:v1", JSON.stringify(settings));
  applyAppearance(settings);
  const expected = document.documentElement.getAttribute("style");
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-wavekb-reduce-motion");
  Function(APPEARANCE_BOOTSTRAP)();
  expect(document.documentElement.getAttribute("style")).toBe(expected);
  expect(document.documentElement.dataset.wavekbReduceMotion).toBe("true");
});

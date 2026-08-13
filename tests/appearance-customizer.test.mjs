import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const require = createRequire(import.meta.url);
const appearance = require(fileURLToPath(new URL("../community/appearance-core.js", import.meta.url)));

test("appearance settings normalize untrusted browser values", () => {
  assert.deepEqual(appearance.normalize({theme: "unknown", mode: "nope", customColor: "red"}), appearance.DEFAULTS);
  assert.deepEqual(appearance.normalize({theme: "sakura", mode: "dark", customColor: "#A6426D"}), {
    theme: "sakura",
    mode: "dark",
    customColor: "#a6426d"
  });
});

test("appearance presets include restrained anime color directions", () => {
  assert.equal(appearance.THEMES.wave.label, "深海波纹");
  assert.equal(appearance.THEMES.sakura.label, "樱庭");
  assert.equal(appearance.THEMES.aurora.label, "极光机甲");
  assert.equal(appearance.THEMES.star.label, "星夜紫");
  assert.equal(appearance.THEMES.ink.label, "墨白");
});

test("custom color helpers validate values and choose readable text", () => {
  assert.equal(appearance.isHexColor("#208f8a"), true);
  assert.equal(appearance.isHexColor("javascript:alert(1)"), false);
  assert.equal(appearance.textOnColor("#102033"), "#f7fbff");
  assert.equal(appearance.textOnColor("#f8dbe7"), "#102033");
});

test("appearance is browser-local and does not call account or database services", async () => {
  const [core, ui] = await Promise.all([
    read("community/appearance-core.js"),
    read("community/appearance-ui.js")
  ]);
  assert.match(core, /wavekb:appearance:v1/);
  assert.match(ui, /window\.localStorage/);
  assert.match(ui, /sidebar\.insertBefore\(host, navigation\)/);
  assert.doesNotMatch(core + ui, /supabase|fetch\(|XMLHttpRequest|profiles|auth\./i);
});

test("appearance CSS covers presets, explicit modes, mobile, and reduced preferences", async () => {
  const css = await read("community/appearance.css");
  for (const theme of ["sakura", "aurora", "star", "ink", "custom"]) {
    assert.match(css, new RegExp(`data-wavekb-theme=\\"${theme}\\"`));
  }
  assert.match(css, /data-wavekb-mode="dark"/);
  assert.match(css, /data-wavekb-mode="light"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /data-wavekb-theme\]\[data-wavekb-mode="dark"\]/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /\.mentor-dialog[\s\S]*?var\(--wavekb-surface\) !important/);
  assert.doesNotMatch(css, /--wavekb-(?:page|surface|text|heading|muted):\s*light-dark\(/);
});

test("both local site documents load the appearance layer with fresh cache markers", async () => {
  const documents = await Promise.all([read("index.html"), read("elliott-wave-preview.html")]);
  for (const html of documents) {
    assert.match(html, /community\/appearance\.css\?v=wavekb-theme-readability-20260813-1/);
    assert.match(html, /community\/appearance-core\.js\?v=wavekb-appearance-20260803-3/);
    assert.match(html, /community\/appearance-ui\.js\?v=wavekb-appearance-20260803-3/);
  }
});

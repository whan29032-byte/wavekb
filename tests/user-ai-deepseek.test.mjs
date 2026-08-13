import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const require = createRequire(import.meta.url);
const core = require(fileURLToPath(new URL("../community/user-ai-core.js", import.meta.url)));

test("DeepSeek is exposed as an OpenAI-compatible user-owned provider preset", () => {
  const preset = core.PROVIDER_PRESETS.deepseek;
  assert.equal(preset.label, "DeepSeek");
  assert.equal(preset.adapter, "openai_compatible");
  assert.equal(preset.baseUrl, "https://api.deepseek.com");
  assert.equal(preset.modelName, "deepseek-v4-flash");
});

test("DeepSeek connections pass the existing backend validation contract", () => {
  const result = core.validateConnection({
    label: "我的 DeepSeek",
    adapter: core.PROVIDER_PRESETS.deepseek.adapter,
    base_url: core.PROVIDER_PRESETS.deepseek.baseUrl,
    model_name: core.PROVIDER_PRESETS.deepseek.modelName,
    api_key: "test-key-not-saved"
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.adapter, "openai_compatible");
  assert.equal(core.connectionSummary(result.value).adapter, "DeepSeek");
});

test("workbench exposes user AI settings and keeps API keys server-bound", async () => {
  const [member, workbench, ui] = await Promise.all([
    read("community/member-ui.js"),
    read("workbench/workbench-ui.js"),
    read("community/user-ai-ui.js")
  ]);
  assert.doesNotMatch(member, /label: "AI 控制中心"/);
  assert.match(workbench, /#workbench=new&step=0&panel=ai/);
  assert.match(workbench, /"AI 模型"/);
  assert.doesNotMatch(member, /label: "我的 AI 接口"/);
  assert.match(ui, /AI 控制中心/);
  assert.match(ui, /key\.type = "password"/);
  assert.match(ui, /request\("\/v1\/user\/ai-connections", \{/);
  assert.match(ui, /method: "POST"/);
  assert.doesNotMatch(ui, /localStorage[^\n]*api[_-]?key/i);
  assert.doesNotMatch(ui, /URLSearchParams[^\n]*api[_-]?key/i);
});

test("local documents carry fresh social and BYOK cache markers", async () => {
  const [main, preview] = await Promise.all([
    read("index.html"),
    read("elliott-wave-preview.html")
  ]);
  for (const html of [main, preview]) {
    assert.match(html, /wavekb-social-admin-20260804-2/);
    assert.match(html, /wavekb-workbench-ai-20260803-2/);
  }
});

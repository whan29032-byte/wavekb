import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { DeepSeekProvider } from "../src/providers/deepseek.ts";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.ts";
import { AnthropicProvider } from "../src/providers/anthropic.ts";
import { GeminiProvider } from "../src/providers/gemini.ts";
import { createProvider } from "../src/providers/registry.ts";
import { validateAnalysisResult } from "../src/pipeline/validate-result.ts";

type CapturedRequest = { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> };
async function localServer(options: { body?: unknown; status?: number; location?: string } = {}) {
  const captured: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      captured.push({ path: request.url || "", headers: request.headers, body: JSON.parse(raw) as Record<string, unknown> });
      response.statusCode = options.status ?? 200;
      response.setHeader("content-type", "application/json");
      if (options.location) response.setHeader("location", options.location);
      response.end(JSON.stringify(options.body ?? {
        id: "deepseek-test-request", choices: [{ message: { content: '{"ok":true}', reasoning_content: "internal reasoning", tool_calls: [{ name: "private-tool" }] }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 7, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 7,
          completion_tokens_details: { reasoning_tokens: 2 } },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { captured, baseUrl, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
const request = {
  model: "deepseek-flash", system: "检查候选结构，不泄露任何内部来源。",
  messages: [{ role: "user" as const, content: "判断当前波浪结构" }],
  maxOutputTokens: 2048, temperature: 0.2, timeoutMs: 2000,
};

for (const basePath of ["", "/v1"]) {
  test(`DeepSeek maps JSON-object payload and token accounting with base path ${basePath || "root"}`, async (t) => {
    const mock = await localServer(); t.after(mock.close);
    const provider = new DeepSeekProvider({ baseUrl: `${mock.baseUrl}${basePath}`, apiKey: "test-only-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
    const result = await provider.invoke({ ...request, responseFormat: "json_object" });
    const sent = mock.captured[0]!;
    assert.equal(sent.path, "/v1/chat/completions");
    assert.equal(sent.headers.authorization, "Bearer test-only-key");
    assert.equal(sent.body.model, "deepseek-flash");
    assert.equal(sent.body.max_tokens, 2048);
    assert.equal(sent.body.temperature, 0.2);
    assert.equal(sent.body.stream, false);
    assert.deepEqual(sent.body.response_format, { type: "json_object" });
    assert.deepEqual(sent.body.thinking, { type: "disabled" });
    assert.ok(!Object.hasOwn(sent.body, "reasoning_effort"));
    assert.ok(!Object.hasOwn(sent.body, "max_completion_tokens"));
    assert.ok(!Object.hasOwn(sent.body, "json_schema"));
    assert.match(String((sent.body.messages as Array<{ content: unknown }>)[0]!.content), /JSON/);
    assert.deepEqual((sent.body.messages as unknown[]).slice(1), request.messages);
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7 });
    assert.equal(result.providerRequestId, "deepseek-test-request");
    assert.equal(result.finishReason, "stop");
    assert.equal(result.text, '{"ok":true}');
    assert.deepEqual(result.structured, { ok: true });
    assert.ok(!JSON.stringify(result).includes("internal reasoning"));
    assert.ok(!JSON.stringify(result).includes("private-tool"));
  });
}

test("DeepSeek schema requests use json_object without transmitting unsupported json_schema", async (t) => {
  const mock = await localServer(); t.after(mock.close);
  const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-only-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
  await provider.invoke({ ...request, model: "deepseek-v4-pro", responseSchema: { type: "object", properties: { should_not_be_sent: { type: "string" } } } });
  const sent = mock.captured[0]!.body;
  assert.equal(sent.model, "deepseek-v4-pro");
  assert.deepEqual(sent.response_format, { type: "json_object" });
  assert.deepEqual(sent.thinking, { type: "disabled" });
  assert.ok(!Object.hasOwn(sent, "reasoning_effort"));
  assert.ok(!JSON.stringify(sent).includes("should_not_be_sent"));
  assert.ok(!JSON.stringify(sent).includes("json_schema"));
});

test("DeepSeek plain-text requests do not opt into JSON mode", async (t) => {
  const mock = await localServer({ body: { choices: [{ message: { content: "plain answer" } }] } }); t.after(mock.close);
  const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-only-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
  const result = await provider.invoke(request);
  assert.equal(mock.captured[0]!.body.response_format, undefined);
  assert.ok(!Object.hasOwn(mock.captured[0]!.body, "thinking"));
  assert.ok(!Object.hasOwn(mock.captured[0]!.body, "reasoning_effort"));
  assert.equal((mock.captured[0]!.body.messages as Array<{ content: unknown }>)[0]!.content, request.system);
  assert.equal(result.text, "plain answer");
  assert.equal(result.structured, undefined);
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
});

test("DeepSeek truncated JSON preserves finish reason and total usage without exposing hidden reasoning", async (t) => {
  const mock = await localServer({ body: { id: "truncated-test", choices: [{ message: {
    content: '{"instrument":', reasoning_content: "hidden reasoning must remain private",
  }, finish_reason: "length" }], usage: { prompt_tokens: 20, completion_tokens: 4096,
    completion_tokens_details: { reasoning_tokens: 4000 } } } }); t.after(mock.close);
  const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-only-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
  const result = await provider.invoke({ ...request, responseFormat: "json_object" });
  assert.deepEqual(mock.captured[0]!.body.thinking, { type: "disabled" });
  assert.equal(result.finishReason, "length");
  assert.equal(result.structured, undefined);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 4096 });
  assert.equal(result.providerRequestId, "truncated-test");
  assert.ok(!JSON.stringify(result).includes("hidden reasoning"));
  assert.throws(() => validateAnalysisResult(result.structured ?? {}, new Set()), /analysis result schema/);
});

for (const content of ["", "not JSON", null, { internal: "not a textual answer" }]) {
  test(`DeepSeek empty or malformed content ${JSON.stringify(content)} reaches existing output validation without reasoning fallback`, async (t) => {
    const mock = await localServer({ body: { choices: [{ message: { content, reasoning_content: '{"secret":true}', tool_calls: [{ name: "private-tool" }] } }], usage: { prompt_tokens: -1, completion_tokens: "7" } } }); t.after(mock.close);
    const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-only-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
    const result = await provider.invoke({ ...request, responseFormat: "json_object" });
    assert.equal(result.text, typeof content === "string" ? content : "");
    assert.equal(result.structured, undefined);
    assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
    assert.ok(!JSON.stringify(result).includes("secret"));
    assert.ok(!JSON.stringify(result).includes("private-tool"));
    assert.throws(() => validateAnalysisResult(result.structured ?? {}, new Set()), /analysis result schema/);
  });
}

for (const [status, code] of [[401, "AUTH"], [403, "AUTH"], [429, "RATE_LIMIT"], [500, "UPSTREAM"], [400, "REQUEST"]] as const) {
  test(`DeepSeek HTTP ${status} preserves the existing ${code} error classification`, async (t) => {
    const mock = await localServer({ status, body: { error: { message: "upstream details must not be returned" } } }); t.after(mock.close);
    const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-only-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
    await assert.rejects(provider.invoke(request), (error: unknown) => (error as { status?: number; code?: string }).status === status && (error as { code?: string }).code === code);
  });
}

test("DeepSeek never follows redirects, including to another local server", async (t) => {
  const destination = await localServer(); t.after(destination.close);
  const mock = await localServer({ status: 302, location: destination.baseUrl }); t.after(mock.close);
  const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-only-key", allowedLocalHosts: [new URL(mock.baseUrl).host, new URL(destination.baseUrl).host] });
  await assert.rejects(provider.invoke(request), /redirects are not allowed/);
  assert.equal(mock.captured.length, 1);
  assert.equal(destination.captured.length, 0);
});

test("DeepSeek still requires the existing explicit local-host allowlist", async (t) => {
  const mock = await localServer(); t.after(mock.close);
  const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-only-key", allowedLocalHosts: [] });
  await assert.rejects(provider.invoke(request), /not allowlisted/);
  assert.equal(mock.captured.length, 0);
});

test("registry selects DeepSeek only for openai_compatible with the exact official hostname and performs no network calls", () => {
  for (const baseUrl of ["https://api.deepseek.com", "https://api.deepseek.com/v1", "https://API.DEEPSEEK.COM/v1"]) {
    assert.ok(createProvider("openai_compatible", { baseUrl, apiKey: "test-only-key" }) instanceof DeepSeekProvider);
  }
  for (const baseUrl of ["https://api.deepseek.com.attacker.example/v1", "https://evil-api.deepseek.com/v1", "https://api.deepseek.com./v1", "https://api.deepseek.com@attacker.example/v1", "https://api.openai.com/v1", "not a URL"]) {
    assert.ok(createProvider("openai_compatible", { baseUrl, apiKey: "test-only-key" }) instanceof OpenAICompatibleProvider);
  }
  assert.ok(createProvider("anthropic", { baseUrl: "https://api.deepseek.com", apiKey: "test-only-key" }) instanceof AnthropicProvider);
  assert.ok(createProvider("gemini", { baseUrl: "https://api.deepseek.com", apiKey: "test-only-key" }) instanceof GeminiProvider);
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { AnthropicProvider } from "../src/providers/anthropic.ts";
import { GeminiProvider } from "../src/providers/gemini.ts";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.ts";
import { DeepSeekProvider } from "../src/providers/deepseek.ts";
import { VISION_MAX_BYTES } from "../src/research/vision-input.ts";

async function mockServer(body: unknown, inspect: (requestBody: any, headers: any) => void) {
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      inspect(JSON.parse(raw), request.headers);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const request = {
  model: "mock-model",
  system: "只输出结构化结果",
  messages: [{ role: "user" as const, content: "检查浪型" }],
  maxOutputTokens: 1000,
  temperature: 0.2,
  timeoutMs: 2000,
};

test("OpenAI-compatible adapter maps response and usage", async () => {
  const mock = await mockServer({
    id: "req-1",
    choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 7 },
  }, (body, headers) => {
    assert.equal(headers.authorization, "Bearer test-key");
    assert.equal(body.model, "mock-model");
  });
  const provider = new OpenAICompatibleProvider({
    baseUrl: mock.baseUrl,
    apiKey: "test-key",
    allowedLocalHosts: [new URL(mock.baseUrl).host],
  });
  const result = await provider.invoke(request);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7 });
  assert.equal(result.providerRequestId, "req-1");
  await mock.close();
});

test("Anthropic and Gemini adapters normalize provider-specific responses", async () => {
  const anthropicMock = await mockServer({
    id: "msg-1", content: [{ type: "text", text: "anthropic" }],
    stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 4 },
  }, (_body, headers) => assert.equal(headers["anthropic-version"], "2023-06-01"));
  const anthropic = new AnthropicProvider({
    baseUrl: anthropicMock.baseUrl,
    apiKey: "test-key",
    allowedLocalHosts: [new URL(anthropicMock.baseUrl).host],
  });
  assert.equal((await anthropic.invoke(request)).text, "anthropic");
  await anthropicMock.close();

  const geminiMock = await mockServer({
    responseId: "gem-1",
    candidates: [{ content: { parts: [{ text: "gemini" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 },
  }, (_body, headers) => assert.equal(headers["x-goog-api-key"], "test-key"));
  const gemini = new GeminiProvider({
    baseUrl: geminiMock.baseUrl,
    apiKey: "test-key",
    allowedLocalHosts: [new URL(geminiMock.baseUrl).host],
  });
  assert.equal((await gemini.invoke(request)).text, "gemini");
  await geminiMock.close();
});

test("provider adapters never follow redirects", async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 302;
    response.setHeader("location", "http://127.0.0.1/private");
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const provider = new OpenAICompatibleProvider({
    baseUrl,
    apiKey: "test-key",
    allowedLocalHosts: [new URL(baseUrl).host],
  });
  await assert.rejects(() => provider.invoke(request), /redirects are not allowed/);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Genuine 2x3 PNG. Never use remote assets or real provider credentials in tests.
const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPgUbLgUbJgQKEAGCcCZRaxQyQAAAAASUVORK5CYII=";
const imagePart = (url = pngDataUrl) => ({ type: "image_url", image_url: { url, detail: "original" } });

test("DeepSeek Flash sends genuine image parts and text with bounded JSON settings", async () => {
  let received = 0;
  const messages = [{ role: "user" as const, content: [{ type: "text", text: "分析我选择的行情截图" }, imagePart()] }];
  const mock = await mockServer({
    id: "vision-1", choices: [{ message: { content: "{\"observed\":true}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1028, completion_tokens: 14 },
  }, (body, headers) => {
    received += 1;
    assert.equal(headers.authorization, "Bearer test-key");
    assert.equal(body.model, "deepseek-flash");
    assert.deepEqual(body.messages.slice(1), messages);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.stream, false);
  });
  try {
    const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
    const result = await provider.invoke({ ...request, model: "deepseek-flash", messages, responseFormat: "json_object" });
    assert.equal(received, 1);
    assert.deepEqual(result.structured, { observed: true });
    assert.deepEqual(result.usage, { inputTokens: 1028, outputTokens: 14 });
    assert.equal(result.providerRequestId, "vision-1");
  } finally { await mock.close(); }
});

test("DeepSeek image capabilities are explicit and V4 Pro rejects images before network", async () => {
  let received = 0;
  const mock = await mockServer({}, () => { received += 1; });
  try {
    const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
    assert.equal(provider.supportsImages("deepseek-flash"), true);
    for (const model of ["deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner", "deepseek-flash-unknown", "DEEPSEEK-FLASH"]) {
      assert.equal(provider.supportsImages(model), false);
      await assert.rejects(() => provider.invoke({ ...request, model, messages: [{ role: "user", content: [imagePart()] }] }),
        (error: any) => error.message === "invalid_image_input" && error.code === "invalid_image_input" && error.status === 400);
    }
    assert.equal(received, 0);
  } finally { await mock.close(); }
});

test("DeepSeek refuses external images, malformed protocol parts and excessive frames before network", async () => {
  let received = 0;
  const mock = await mockServer({}, () => { received += 1; });
  const substitutedContent = [imagePart("https://example.com/private.png")];
  Object.defineProperty(substitutedContent, Symbol.iterator, { value: function* () { yield { type: "text", text: "benign" }; } });
  const inheritedIteratorContent = [imagePart("https://example.com/private.png")];
  Object.setPrototypeOf(inheritedIteratorContent, { [Symbol.iterator]: function* () { yield { type: "text", text: "benign" }; } });
  const invalid = [
    [{ role: "assistant", content: [imagePart()] }],
    [{ role: { toString: () => "user" }, content: [imagePart()] }],
    [{ role: "user", content: [imagePart("https://example.com/private.png")] }],
    [{ role: "user", content: [imagePart("javascript:alert(1)")] }],
    [{ role: "user", content: [imagePart("file:///tmp/private.png")] }],
    [{ role: "user", content: [imagePart("data:image/svg+xml;base64,PHN2Zy8+")] }],
    [{ role: "user", content: [imagePart(pngDataUrl.replace("image/png", "image/jpeg"))] }],
    [{ role: "user", content: [imagePart(pngDataUrl.replace("base64,", "base64,\n"))] }],
    [{ role: "user", content: [imagePart("data:image/png;base64,AAB=")] }],
    [{ role: "user", content: [imagePart("data:image/png;base64," + "A".repeat(Math.ceil(VISION_MAX_BYTES / 3) * 4 + 4))] }],
    [{ role: "user", content: [{ type: "image_url", image_url: { url: pngDataUrl, detail: "original", source_path: "/private/book.pdf" } }] }],
    [{ role: "user", content: [{ type: "image_url", image_url: { url: pngDataUrl, detail: { toString: () => "original" } } }] }],
    [{ role: "user", content: [{ type: "image_url", image_url: { url: pngDataUrl }, file_id: "hidden-file" }] }],
    [{ role: "user", content: [{ type: "file", file_id: "hidden-file" }] }],
    [{ role: "user", content: [{ type: "text", text: "hello", image_url: { url: pngDataUrl } }] }],
    [{ role: "user", content: [imagePart(), imagePart(), imagePart(), imagePart()] }],
    [{ role: "user", content: [imagePart(), imagePart()] }, { role: "user", content: [imagePart(), imagePart()] }],
    [{ role: "user", content: substitutedContent }],
    [{ role: "user", content: inheritedIteratorContent }],
    [{ role: "user", content: new Array(1) }],
  ];
  try {
    const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
    for (const messages of invalid) {
      await assert.rejects(() => provider.invoke({ ...request, model: "deepseek-flash", messages: messages as any }),
        (error: any) => error.message === "invalid_image_input" && error.code === "invalid_image_input" && error.status === 400);
    }
    assert.equal(received, 0);
  } finally { await mock.close(); }
});

test("DeepSeek text-only V4 Pro requests remain supported", async () => {
  const mock = await mockServer({
    choices: [{ message: { content: "普通文本" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 4 },
  }, (body) => {
    assert.equal(body.model, "deepseek-v4-pro");
    assert.deepEqual(body.messages[1], request.messages[0]);
    assert.equal(body.response_format, undefined);
  });
  try {
    const provider = new DeepSeekProvider({ baseUrl: mock.baseUrl, apiKey: "test-key", allowedLocalHosts: [new URL(mock.baseUrl).host] });
    assert.equal((await provider.invoke({ ...request, model: "deepseek-v4-pro" })).text, "普通文本");
  } finally { await mock.close(); }
});

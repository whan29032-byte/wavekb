import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { AnthropicProvider } from "../src/providers/anthropic.ts";
import { GeminiProvider } from "../src/providers/gemini.ts";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.ts";

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

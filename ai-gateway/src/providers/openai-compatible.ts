import { endpoint, postJson } from "./http.ts";
import type { ModelProvider, ProviderConfig, ProviderRequest, ProviderResult } from "./types.ts";

export class OpenAICompatibleProvider implements ModelProvider {
  private readonly config: ProviderConfig;
  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResult> {
    const payload = await postJson(
      endpoint(this.config, "/v1/chat/completions"),
      { authorization: `Bearer ${this.config.apiKey}` },
      {
        model: request.model,
        messages: [{ role: "system", content: request.system }, ...request.messages],
        max_completion_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        stream: false,
        ...(request.responseSchema
          ? { response_format: { type: "json_schema", json_schema: request.responseSchema } }
          : {}),
      },
      request.timeoutMs,
      this.config.allowedLocalHosts,
    );
    const text = payload.choices?.[0]?.message?.content ?? "";
    let structured: unknown;
    if (request.responseSchema) {
      try { structured = JSON.parse(text); } catch { structured = undefined; }
    }
    return {
      text,
      ...(structured === undefined ? {} : { structured }),
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      },
      ...(payload.id ? { providerRequestId: payload.id } : {}),
      finishReason: payload.choices?.[0]?.finish_reason ?? "unknown",
    };
  }
}

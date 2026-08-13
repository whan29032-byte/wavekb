import { endpoint, postJson } from "./http.ts";
import type { ModelProvider, ProviderConfig, ProviderRequest, ProviderResult } from "./types.ts";

export class AnthropicProvider implements ModelProvider {
  private readonly config: ProviderConfig;
  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResult> {
    const payload = await postJson(
      endpoint(this.config, "/v1/messages"),
      { "x-api-key": this.config.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: request.model,
        system: request.system,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
      },
      request.timeoutMs,
    );
    const text = (payload.content ?? [])
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.text)
      .join("");
    return {
      text,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0,
      },
      ...(payload.id ? { providerRequestId: payload.id } : {}),
      finishReason: payload.stop_reason ?? "unknown",
    };
  }
}

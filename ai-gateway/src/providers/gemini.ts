import { endpoint, postJson } from "./http.ts";
import type { ModelProvider, ProviderConfig, ProviderRequest, ProviderResult } from "./types.ts";

export class GeminiProvider implements ModelProvider {
  private readonly config: ProviderConfig;
  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResult> {
    const model = encodeURIComponent(request.model);
    const payload = await postJson(
      endpoint(this.config, `/v1beta/models/${model}:generateContent`),
      { "x-goog-api-key": this.config.apiKey },
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: request.messages.map((item) => ({
          role: item.role === "assistant" ? "model" : "user",
          parts: typeof item.content === "string" ? [{ text: item.content }] : item.content,
        })),
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens,
          temperature: request.temperature,
          ...(request.responseSchema
            ? { responseFormat: { text: { mimeType: "application/json", schema: request.responseSchema } } }
            : {}),
        },
      },
      request.timeoutMs,
      this.config.allowedLocalHosts,
    );
    const candidate = payload.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((item: any) => item.text ?? "")
      .join("");
    return {
      text,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
      },
      ...(payload.responseId ? { providerRequestId: payload.responseId } : {}),
      finishReason: candidate?.finishReason ?? "unknown",
    };
  }
}

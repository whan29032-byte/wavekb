import { endpoint, postJson } from "./http.ts";
import type { ModelProvider, ProviderConfig, ProviderRequest, ProviderResult } from "./types.ts";

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Official DeepSeek Chat Completions profile. No access to tools or reasoning. */
export class DeepSeekProvider implements ModelProvider {
  private readonly config: ProviderConfig;
  constructor(config: ProviderConfig) { this.config = config; }

  async invoke(request: ProviderRequest): Promise<ProviderResult> {
    const jsonObject = request.responseFormat === "json_object" || request.responseSchema !== undefined;
    // JSON mode requires the word JSON in the prompt. The application still
    // validates the actual schema; DeepSeek Chat accepts json_object, not the
    // OpenAI json_schema payload.
    const system = jsonObject ? `${request.system}\nReturn one JSON object only, without Markdown or commentary.` : request.system;
    const payload = await postJson(
      endpoint(this.config, "/v1/chat/completions"),
      { authorization: `Bearer ${this.config.apiKey}` },
      {
        model: request.model,
        messages: [{ role: "system", content: system }, ...request.messages],
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        stream: false,
        // JSON jobs have a bounded final-answer budget. Do not allow default
        // hidden thinking to consume it; ordinary text keeps provider defaults.
        ...(jsonObject ? { response_format: { type: "json_object" }, thinking: { type: "disabled" } } : {}),
      },
      request.timeoutMs,
      this.config.allowedLocalHosts,
    );
    const message = payload?.choices?.[0]?.message;
    // Never substitute reasoning_content or tool_calls for a missing answer.
    const text = typeof message?.content === "string" ? message.content : "";
    let structured: unknown;
    if (jsonObject) {
      try { structured = JSON.parse(text); } catch { structured = undefined; }
    }
    return {
      text,
      ...(structured === undefined ? {} : { structured }),
      usage: { inputTokens: tokenCount(payload?.usage?.prompt_tokens), outputTokens: tokenCount(payload?.usage?.completion_tokens) },
      ...(typeof payload?.id === "string" && payload.id ? { providerRequestId: payload.id } : {}),
      finishReason: typeof payload?.choices?.[0]?.finish_reason === "string" ? payload.choices[0].finish_reason : "unknown",
    };
  }
}

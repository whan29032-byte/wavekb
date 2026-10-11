import { endpoint, postJson } from "./http.ts";
import type { ModelProvider, ProviderConfig, ProviderRequest, ProviderResult } from "./types.ts";
import { VISION_MAX_BYTES, VISION_MAX_IMAGES } from "../research/vision-input.ts";
import { inspectVisionImage } from "../research/vision-image-format.ts";

function invalidImage(): never { throw Object.assign(new Error("invalid_image_input"), { code: "invalid_image_input", status: 400 }); }
function exactObject(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalidImage();
  const object = value as Record<string, unknown>, allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(object, key)) || Reflect.ownKeys(object).some((key) => typeof key !== "string"
    || !allowed.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(object, key) ?? {}, "value"))) invalidImage();
  return object;
}
function exactArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1
    || Reflect.ownKeys(value).some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value")))) invalidImage();
  return value;
}

function validateMessages(request: ProviderRequest, supportsImages: boolean): void {
  let images = 0;
  for (const message of exactArray(request.messages)) {
    const item = exactObject(message, ["role", "content"]);
    if (typeof item.role !== "string" || !["user", "assistant"].includes(item.role)) invalidImage();
    if (typeof item.content === "string") continue;
    const content = exactArray(item.content);
    if (!content.length || content.length > VISION_MAX_IMAGES + 1) invalidImage();
    for (const raw of content) {
      const part = exactObject(raw, ["type"], ["text", "image_url"]);
      if (part.type === "text") {
        if (Object.keys(part).length !== 2 || typeof part.text !== "string") invalidImage();
      } else if (part.type === "image_url") {
        if (!supportsImages || item.role !== "user" || Object.keys(part).length !== 2 || ++images > VISION_MAX_IMAGES) invalidImage();
        const image = exactObject(part.image_url, ["url"], ["detail"]);
        if (image.detail !== undefined && (typeof image.detail !== "string" || !["original", "high", "low", "auto"].includes(image.detail))) invalidImage();
        if (typeof image.url !== "string" || image.url.length > Math.ceil(VISION_MAX_BYTES / 3) * 4 + 64) invalidImage();
        const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(image.url);
        if (!match || match[2]!.length % 4) invalidImage();
        const bytes = Buffer.from(match[2]!, "base64");
        if (bytes.toString("base64") !== match[2]) invalidImage();
        try { if (inspectVisionImage(bytes).mimeType !== match[1]) invalidImage(); }
        catch { invalidImage(); }
      } else invalidImage();
    }
  }
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Official DeepSeek Chat Completions profile. No access to tools or reasoning. */
export class DeepSeekProvider implements ModelProvider {
  private readonly config: ProviderConfig;
  constructor(config: ProviderConfig) { this.config = config; }
  supportsImages(model: string): boolean { return model === "deepseek-flash"; }

  async invoke(request: ProviderRequest): Promise<ProviderResult> {
    validateMessages(request, this.supportsImages(request.model));
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

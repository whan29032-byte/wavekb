import { AnthropicProvider } from "./anthropic.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAICompatibleProvider } from "./openai-compatible.ts";
import type { ModelProvider, ProviderConfig } from "./types.ts";

export type Adapter = "openai_compatible" | "anthropic" | "gemini";

export function createProvider(adapter: Adapter, config: ProviderConfig): ModelProvider {
  if (adapter === "anthropic") return new AnthropicProvider(config);
  if (adapter === "gemini") return new GeminiProvider(config);
  return new OpenAICompatibleProvider(config);
}

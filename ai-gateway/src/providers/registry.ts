import { AnthropicProvider } from "./anthropic.ts";
import { DeepSeekProvider } from "./deepseek.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAICompatibleProvider } from "./openai-compatible.ts";
import type { ModelProvider, ProviderConfig } from "./types.ts";

export type Adapter = "openai_compatible" | "anthropic" | "gemini";

export function createProvider(adapter: Adapter, config: ProviderConfig): ModelProvider {
  if (adapter === "anthropic") return new AnthropicProvider(config);
  if (adapter === "gemini") return new GeminiProvider(config);
  // This is a protocol profile, not a new public adapter. Only the exact
  // official hostname uses DeepSeek's Chat Completions contract.
  try {
    if (adapter === "openai_compatible" && new URL(config.baseUrl).hostname === "api.deepseek.com") {
      return new DeepSeekProvider(config);
    }
  } catch { /* URL validation remains in the existing request boundary. */ }
  return new OpenAICompatibleProvider(config);
}

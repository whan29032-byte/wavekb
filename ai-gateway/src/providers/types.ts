export type ProviderMessage = { role: "user" | "assistant"; content: unknown };
export type ProviderRequest = {
  model: string;
  system: string;
  messages: ProviderMessage[];
  maxOutputTokens: number;
  temperature: number;
  responseSchema?: object;
  timeoutMs: number;
};
export type ProviderResult = {
  text: string;
  structured?: unknown;
  usage: { inputTokens: number; outputTokens: number };
  providerRequestId?: string;
  finishReason: string;
};
export interface ModelProvider {
  invoke(request: ProviderRequest): Promise<ProviderResult>;
}
export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  allowedPublicHosts?: string[];
  allowedLocalHosts?: string[];
};

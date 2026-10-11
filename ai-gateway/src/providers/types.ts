export type ProviderTextPart = { type: "text"; text: string };
export type ProviderImagePart = { type: "image_url"; image_url: { url: string; detail?: "original" | "high" | "low" | "auto" } };
export type ProviderMessage = { role: "user" | "assistant"; content: unknown };
export type ProviderRequest = {
  model: string;
  system: string;
  messages: ProviderMessage[];
  maxOutputTokens: number;
  temperature: number;
  responseFormat?: "json_object";
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
  supportsImages?(model: string): boolean;
  invoke(request: ProviderRequest): Promise<ProviderResult>;
}
export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  allowedPublicHosts?: string[];
  allowedLocalHosts?: string[];
};

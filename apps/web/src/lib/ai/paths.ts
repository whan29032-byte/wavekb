const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function isAllowedAiPath(path: string, method: "GET" | "POST") {
  if (path === "user/ai-connections") return method === "GET" || method === "POST";
  if (method === "POST" && new RegExp(`^user/ai-connections/${UUID}/(?:default|rotate-key)$`, "i").test(path)) return true;
  if (method === "POST" && new RegExp(`^analyses/${UUID}/ai-run$`, "i").test(path)) return true;
  return method === "GET" && new RegExp(`^jobs/${UUID}$`, "i").test(path);
}

export function isAllowedAiBodyLength(bytes: number) {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= 64 * 1024;
}

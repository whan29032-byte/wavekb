const readPaths = new Set(["users/summary", "users", "moderation-audit", "directory", "dashboard", "providers", "trading-connections"]);
const userMutationPath = /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(status|mute|role|uid)$/i;
const directoryMutationPath = /^directory(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/delete)?)?$/i;
const tradingMutationPath = /^trading-connections\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/disable$/i;
export const adminMutationBodyLimit = 16 * 1024;

export function isAllowedAdminPath(path: string, method: "GET" | "POST") {
  return method === "GET" ? readPaths.has(path) : userMutationPath.test(path) || directoryMutationPath.test(path) || tradingMutationPath.test(path) || path === "providers";
}

export function isAllowedAdminBodyLength(length: number) {
  return Number.isFinite(length) && length >= 0 && length <= adminMutationBodyLimit;
}

const readPaths = new Set(["users/summary", "users", "moderation-audit"]);
const mutationPath = /^users\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(status|mute|role|uid)$/i;
export const adminMutationBodyLimit = 16 * 1024;

export function isAllowedAdminPath(path: string, method: "GET" | "POST") {
  return method === "GET" ? readPaths.has(path) : mutationPath.test(path);
}

export function isAllowedAdminBodyLength(length: number) {
  return Number.isFinite(length) && length >= 0 && length <= adminMutationBodyLimit;
}

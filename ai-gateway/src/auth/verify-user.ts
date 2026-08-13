export type VerifiedUser = { id: string; email?: string; role: string };

export async function verifySupabaseJwt(
  authorization: string | undefined,
  getUser: (jwt: string) => Promise<{ user: { id: string; email?: string } | null }>,
  getRole: (id: string) => Promise<string>,
): Promise<VerifiedUser> {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw Object.assign(new Error("authentication required"), { statusCode: 401 });
  const result = await getUser(match[1]);
  if (!result.user) throw Object.assign(new Error("invalid or expired token"), { statusCode: 401 });
  const role = await getRole(result.user.id);
  return { ...result.user, role };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicProfile } from "@wavekb/domain";

function missingFunction(error: { code?: string } | null) {
  return error?.code === "PGRST202" || error?.code === "42883";
}

// Use only existing public projections. Older production databases expose the
// equipped identity via UID search, not the newer batch RPC. Never infer an
// entitlement from the UID, and never read unrestricted profile-table columns.
export async function loadPublicIdentities(client: Pick<SupabaseClient, "rpc">, memberIds: string[]): Promise<PublicProfile[]> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (!ids.length) return [];
  const primary = await client.rpc("get_public_post_profiles", { p_ids: ids });
  if (!primary.error) return ((primary.data ?? []) as PublicProfile[]).filter((row) => ids.includes(row.id));
  if (!missingFunction(primary.error)) throw primary.error;

  const basic = await client.rpc("get_public_profiles", { p_ids: ids });
  if (basic.error) throw basic.error;
  const rows = ((basic.data ?? []) as PublicProfile[]).filter((row) => ids.includes(row.id));
  const identities: PublicProfile[] = [];
  // Bound legacy fan-out; one lookup per unique author, not per post/comment.
  for (let offset = 0; offset < rows.length; offset += 4) {
    const batch = await Promise.all(rows.slice(offset, offset + 4).map(async (row) => {
      if (!Number.isSafeInteger(row.public_uid) || Number(row.public_uid) <= 0) return null;
      const result = await client.rpc("search_profile_by_uid", { p_uid: row.public_uid });
      if (result.error) throw result.error;
      const identity = (Array.isArray(result.data) ? result.data[0] : result.data) as PublicProfile | null;
      // A UID reassignment or stale response must never borrow another identity.
      if (!identity || identity.id !== row.id || identity.public_uid !== row.public_uid) return null;
      return {
        id: identity.id, public_uid: identity.public_uid,
        display_name: identity.display_name, avatar_url: identity.avatar_url,
        role: identity.role, display_title: identity.display_title,
        nameplate_style: identity.nameplate_style,
      };
    }));
    for (const identity of batch) if (identity) identities.push(identity);
  }
  return identities;
}

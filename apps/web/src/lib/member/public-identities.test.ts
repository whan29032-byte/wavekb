import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { loadPublicIdentities } from "./public-identities";

const basic = { id: "owner", public_uid: 33333, display_name: "研究者", avatar_url: null };
const equipped = { ...basic, role: "member", display_title: "研究者", nameplate_style: "blackgold" };
function client(rpc: ReturnType<typeof vi.fn>) { return { rpc } as unknown as Pick<SupabaseClient, "rpc">; }

it("uses the batch public identity without extra lookups and excludes unrequested IDs", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [equipped, { ...equipped, id: "other" }], error: null });
  expect(await loadPublicIdentities(client(rpc), ["owner", "owner"])).toEqual([equipped]);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("get_public_post_profiles", { p_ids: ["owner"] });
});

it.each(["PGRST202", "42883"])("hydrates legacy equipped identity for missing RPC %s without carrying unrelated profile fields", async (code) => {
  const rpc = vi.fn(async (name: string) => {
    if (name === "get_public_post_profiles") return { data: null, error: { code } };
    if (name === "get_public_profiles") return { data: [basic], error: null };
    return { data: [{ ...equipped, bio: "Not part of compact identity", cover_url: "cover" }], error: null };
  });
  expect(await loadPublicIdentities(client(rpc), ["owner"])).toEqual([equipped]);
});

it.each(["42501", "PGRST301", "503"])("does not turn permission or availability error %s into a fallback query", async (code) => {
  const error = { code, message: "unavailable" };
  const rpc = vi.fn().mockResolvedValue({ data: null, error });
  await expect(loadPublicIdentities(client(rpc), ["owner"])).rejects.toEqual(error);
  expect(rpc).toHaveBeenCalledTimes(1);
});

it.each([{ ...equipped, id: "someone-else" }, { ...equipped, public_uid: 99999 }, null])("never assigns a mismatched or no-longer-visible UID identity", async (identity) => {
  const rpc = vi.fn(async (name: string) => {
    if (name === "get_public_post_profiles") return { data: null, error: { code: "PGRST202" } };
    if (name === "get_public_profiles") return { data: [basic], error: null };
    return { data: identity ? [identity] : [], error: null };
  });
  expect(await loadPublicIdentities(client(rpc), ["owner"])).toEqual([]);
});

it("propagates a failed legacy identity read instead of silently replacing equipped effects with classic", async () => {
  const error = { code: "503", message: "temporary outage" };
  const rpc = vi.fn(async (name: string) => {
    if (name === "get_public_post_profiles") return { data: null, error: { code: "PGRST202" } };
    if (name === "get_public_profiles") return { data: [basic], error: null };
    return { data: null, error };
  });
  await expect(loadPublicIdentities(client(rpc), ["owner"])).rejects.toEqual(error);
});

it("ignores a legacy row with no usable UID without failing other authors or issuing an unbounded lookup", async () => {
  const rpc = vi.fn(async (name: string, args: { p_uid: number }) => {
    if (name === "get_public_post_profiles") return { data: null, error: { code: "PGRST202" } };
    if (name === "get_public_profiles") return { data: [basic, { ...basic, id: "pending", public_uid: null }], error: null };
    if (args.p_uid === 33333) return { data: [equipped], error: null };
    return { data: null, error: { code: "PGRST202", message: "Missing UID argument" } };
  });
  expect(await loadPublicIdentities(client(rpc), ["owner", "pending"])).toEqual([equipped]);
  expect(rpc.mock.calls.filter(([name]) => name === "search_profile_by_uid")).toHaveLength(1);
});

it("bounds legacy fan-out to four reads while resolving every requested author", async () => {
  const rows = Array.from({ length: 10 }, (_, n) => ({ ...equipped, id: `owner-${n}`, public_uid: 33333 + n }));
  let pending = 0; let maximum = 0;
  const rpc = vi.fn(async (name: string, args: { p_uid: number }) => {
    if (name === "get_public_post_profiles") return { data: null, error: { code: "PGRST202" } };
    if (name === "get_public_profiles") return { data: rows, error: null };
    pending++; maximum = Math.max(maximum, pending);
    await new Promise((resolve) => setTimeout(resolve, 1));
    pending--;
    return { data: rows.filter((row) => row.public_uid === args.p_uid), error: null };
  });
  expect(await loadPublicIdentities(client(rpc), rows.map((row) => row.id))).toEqual(rows);
  expect(maximum).toBeLessThanOrEqual(4);
});

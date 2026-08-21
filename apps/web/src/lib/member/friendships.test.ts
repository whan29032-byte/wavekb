import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FriendshipRpcError, isMissingFriendshipsV2, loadFriendships } from "./friendships";

const connection = {
  friendship_id: "11111111-1111-4111-8111-111111111111",
  status: "accepted",
  direction: "incoming",
  other_id: "22222222-2222-4222-8222-222222222222",
  public_uid: 44444,
  display_name: "好友",
} as const;

describe("friendship RPC compatibility", () => {
  it("uses the hardened friendship reader when available", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [connection], error: null });
    const result = await loadFriendships({ rpc } as unknown as SupabaseClient);

    expect(result).toEqual([connection]);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("list_my_friendships_v2");
  });

  it("falls back during a rolling deployment before the new RPC reaches the schema cache", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } })
      .mockResolvedValueOnce({ data: [connection], error: null });
    const result = await loadFriendships({ rpc } as unknown as SupabaseClient);

    expect(result).toEqual([connection]);
    expect(rpc).toHaveBeenNthCalledWith(1, "list_my_friendships_v2");
    expect(rpc).toHaveBeenNthCalledWith(2, "list_my_friendships");
  });

  it("does not hide operational failures as an empty friend list", async () => {
    const error = { code: "42501", message: "permission denied" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });

    const failure = await loadFriendships({ rpc } as unknown as SupabaseClient).catch((cause) => cause);
    expect(failure).toBeInstanceOf(FriendshipRpcError);
    expect(failure).toMatchObject({
      name: "FriendshipRpcError",
      rpc: "list_my_friendships_v2",
      code: "42501",
      message: "permission denied",
    });
    expect(isMissingFriendshipsV2(error)).toBe(false);
  });
});

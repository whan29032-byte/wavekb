import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FriendDirectory } from "./friend-directory";
import { SocialDesktop } from "./social-desktop";
import { useMemberPresence } from "@/hooks/use-member-presence";
import { installBrowserStorage } from "@/test/browser-storage";

const boundary = vi.hoisted(() => ({ client: {} as Record<string, unknown>, router: { replace: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => boundary.router }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => boundary.client }));
vi.mock("@/lib/member/friends-api-client", () => ({
  readFriends: async () => ({ actorId: "actor", actor: { id: "actor", public_uid: 12345, display_name: "测试成员", avatar_url: null, display_title: "", nameplate_style: "classic", role: "member" }, connections: [], conversations: [] }),
}));

let sync: () => void;
let online: Record<string, { user_id: string }[]>;
let subscriptions: number;
let removals: number;
beforeEach(() => {
  installBrowserStorage();
  window.localStorage.clear();
  subscriptions = 0; removals = 0; online = {};
  let joined = false;
  let current: ReturnType<typeof makeChannel> | undefined;
  // The external boundary mirrors Supabase's same-topic channel reuse and
  // rejection of callbacks registered after subscribe; no network or user data.
  function makeChannel() {
    return {
      on: (_type: string, _filter: unknown, listener: () => void) => {
        if (joined) throw new Error("cannot add presence callbacks after subscribe()");
        sync = listener;
        return current!;
      },
      subscribe: (callback: (status: string) => void) => { joined = true; subscriptions++; callback("SUBSCRIBED"); return current!; },
      track: async () => "ok",
      untrack: async () => "ok",
      presenceState: () => online,
    };
  }
  boundary.client = {
    channel: () => current ??= makeChannel(),
    removeChannel: async () => { removals++; joined = false; current = undefined; },
    auth: { getSession: async () => ({ data: { session: { user: { id: "actor" } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    rpc: async () => ({ data: [], error: null }),
  };
});
afterEach(async () => { cleanup(); await new Promise((resolve) => setTimeout(resolve, 0)); });

it("opens complete management alongside the desktop and keeps presence alive after navigation", async () => {
  const desktop = render(<SocialDesktop />);
  await screen.findByRole("link", { name: /完整管理/ });
  const directory = render(<FriendDirectory />);
  await waitFor(() => expect(document.querySelector("[data-load-state=ready]")).not.toBeNull());
  expect(subscriptions).toBe(1);
  directory.unmount();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(removals).toBe(0);
  await act(async () => { online = { actor: [{ user_id: "actor" }] }; sync(); });
  expect(screen.getByRole("link", { name: /完整管理/ })).toBeDefined();
  desktop.unmount();
  await waitFor(() => expect(removals).toBe(1));
});

it("shares online snapshots through StrictMode and clears them immediately on logout", async () => {
  const hook = renderHook(({ id }: { id: string | null }) => useMemberPresence(id), { initialProps: { id: "actor" } as { id: string | null }, wrapper: StrictMode });
  await waitFor(() => expect(subscriptions).toBe(1));
  await act(async () => { online = { friend: [{ user_id: "friend" }] }; sync(); });
  expect([...hook.result.current]).toEqual(["friend"]);
  const second = renderHook(() => useMemberPresence("actor"));
  await waitFor(() => expect([...second.result.current]).toEqual(["friend"]));
  hook.rerender({ id: null });
  expect([...hook.result.current]).toEqual([]);
  expect(subscriptions).toBe(1);
  expect(removals).toBe(0);
  second.unmount();
  await waitFor(() => expect(removals).toBe(1));
});

it("removes the previous identity channel before subscribing as another account", async () => {
  const hook = renderHook(({ id }) => useMemberPresence(id), { initialProps: { id: "actor" } });
  await waitFor(() => expect(subscriptions).toBe(1));
  await act(async () => { online = { friend: [{ user_id: "friend" }] }; sync(); });
  hook.rerender({ id: "another-actor" });
  expect([...hook.result.current]).toEqual([]);
  await waitFor(() => expect(subscriptions).toBe(2));
  expect(removals).toBe(1);
});

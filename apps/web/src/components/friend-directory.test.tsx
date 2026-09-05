import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FriendDirectory } from "./friend-directory";

const boundary = vi.hoisted(() => ({ action: vi.fn(), read: vi.fn(), getSession: vi.fn(), owner: "actor" as string | null, authChanged: (() => {}) as (event: string, session: { user: { id: string } } | null) => void, router: { replace: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => boundary.router }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession: boundary.getSession, getUser: async () => ({ data: { user: boundary.owner ? { id: boundary.owner } : null }, error: null }), onAuthStateChange: (callback: typeof boundary.authChanged) => { boundary.authChanged = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }) }));
vi.mock("@/hooks/use-member-presence", () => ({ useMemberPresence: () => new Set(["friend"]) }));
vi.mock("@/lib/member/friends-api-client", () => ({
  readFriends: boundary.read,
  runFriendAction: boundary.action,
}));
const initial = { actorId: "actor", connections: [
    { friendship_id: "accepted", other_id: "friend", public_uid: 12346, display_name: "好友甲", avatar_url: "https://example.test/a.png", nameplate_style: "rainbow", status: "accepted" },
    { friendship_id: "pending", other_id: "request", public_uid: 12347, display_name: "申请乙", nameplate_style: "blackgold", status: "pending", direction: "incoming" },
  ] };
beforeEach(() => {
  boundary.owner = "actor";
  boundary.read.mockReset().mockResolvedValue(initial);
  boundary.action.mockReset();
  boundary.getSession.mockReset().mockImplementation(async () => ({ data: { session: boundary.owner ? { user: { id: boundary.owner } } : null } }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("counts accepted friends only and uses the same identity components", async () => {
  render(<FriendDirectory />);
  await screen.findByText("好友甲");
  expect(document.querySelector("[data-friend-count]")?.getAttribute("data-friend-count")).toBe("1");
  expect(screen.getByText("好友甲").getAttribute("data-nameplate")).toBe("rainbow");
  expect(screen.getByRole("img", { name: "好友甲的头像" })).toBeDefined();
  expect(screen.getByLabelText("UID 12346")).toBeDefined();
});

it("offers a conversation instead of another request for an existing friend", async () => {
  boundary.action.mockResolvedValue({ profile: { id: "friend", public_uid: 12346, display_name: "好友甲", nameplate_style: "rainbow" } });
  render(<FriendDirectory />);
  await screen.findByText("好友甲");
  fireEvent.change(screen.getByLabelText("用户 UID"), { target: { value: "12346" } });
  fireEvent.click(screen.getByRole("button", { name: "查找" }));
  await waitFor(() => expect(screen.getAllByText("好友甲")).toHaveLength(2));
  expect(screen.queryByRole("button", { name: "添加好友" })).toBeNull();
  expect(screen.getByRole("button", { name: "发起会话" })).toBeDefined();
});

it.each([null, "account-b"])("clears old friends immediately and discards a pending list response after switching to %s", async (nextOwner) => {
  let resolveOld!: (value: unknown) => void;
  boundary.read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  render(<FriendDirectory />);
  await waitFor(() => expect(boundary.read).toHaveBeenCalledTimes(1));
  boundary.owner = nextOwner;
  boundary.read.mockResolvedValue({ actorId: nextOwner, connections: [] });
  act(() => boundary.authChanged(nextOwner ? "SIGNED_IN" : "SIGNED_OUT", nextOwner ? { user: { id: nextOwner } } : null));
  await act(async () => resolveOld(initial));
  expect(screen.queryByText("好友甲")).toBeNull();
  expect(screen.queryByText("申请乙")).toBeNull();
});

it.each(["search", "conversation", "respond", "request"])("discards a previous account's %s action response", async (action) => {
  render(<FriendDirectory />); await screen.findByText("好友甲");
  if (action === "request") {
    boundary.action.mockResolvedValueOnce({ profile: { id: "new-friend", public_uid: 22222, display_name: "搜索旧结果", nameplate_style: "classic" } });
    fireEvent.change(screen.getByLabelText("用户 UID"), { target: { value: "22222" } });
    fireEvent.click(screen.getByRole("button", { name: "查找" }));
    await screen.findByText("搜索旧结果");
  }
  let resolveOld!: (value: unknown) => void;
  boundary.action.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  const opened = vi.fn(); window.addEventListener("wavekb:open-chat", opened);
  if (action === "search") { fireEvent.change(screen.getByLabelText("用户 UID"), { target: { value: "22222" } }); fireEvent.click(screen.getByRole("button", { name: "查找" })); }
  else fireEvent.click(screen.getByRole("button", { name: action === "conversation" ? "私聊" : action === "respond" ? "接受" : "添加好友" }));
  await waitFor(() => expect(resolveOld).toBeDefined());
  boundary.owner = "account-b"; boundary.read.mockResolvedValue({ actorId: "account-b", connections: [] });
  act(() => boundary.authChanged("SIGNED_IN", { user: { id: "account-b" } }));
  expect(screen.queryByText("好友甲")).toBeNull();
  expect(screen.queryByText("搜索旧结果")).toBeNull();
  await act(async () => resolveOld({ profile: { id: "new-friend", public_uid: 22222, display_name: "旧异步结果" }, conversationId: "old-chat", connections: initial.connections }));
  expect(screen.queryByText("旧异步结果")).toBeNull();
  expect(screen.queryByText("好友甲")).toBeNull();
  expect(opened).not.toHaveBeenCalled();
  window.removeEventListener("wavekb:open-chat", opened);
});

it("does not duplicate the initial query on ordinary rerenders", async () => {
  const { rerender } = render(<FriendDirectory />); await screen.findByText("好友甲");
  rerender(<FriendDirectory />);
  expect(boundary.read).toHaveBeenCalledTimes(1);
});

it("does not restore a stale startup session after a newer account event", async () => {
  let resolveSession!: (value: unknown) => void;
  boundary.getSession.mockImplementationOnce(() => new Promise((resolve) => { resolveSession = resolve; }));
  boundary.read.mockResolvedValue({ actorId: "account-b", connections: [] });
  render(<FriendDirectory />);
  boundary.owner = "account-b";
  act(() => boundary.authChanged("SIGNED_IN", { user: { id: "account-b" } }));
  await waitFor(() => expect(boundary.read).toHaveBeenCalledTimes(1));
  await act(async () => resolveSession({ data: { session: { user: { id: "actor" } } } }));
  expect(boundary.read).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("好友甲")).toBeNull();
});

it("does not submit an action for a stale displayed owner before its auth event arrives", async () => {
  render(<FriendDirectory />); await screen.findByText("好友甲");
  boundary.owner = "account-b";
  fireEvent.click(screen.getByRole("button", { name: "私聊" }));
  await screen.findByText("登录状态已失效，请重新登录。");
  expect(boundary.action).not.toHaveBeenCalled();
});

it("does not accept a list response belonging to a different authenticated owner", async () => {
  boundary.read.mockResolvedValue({ ...initial, actorId: "different-owner" });
  render(<FriendDirectory />);
  await screen.findByRole("alert");
  expect(screen.queryByText("好友甲")).toBeNull();
});

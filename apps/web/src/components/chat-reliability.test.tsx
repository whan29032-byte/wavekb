import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DirectConversation, DirectMessage, FriendshipConnection } from "@wavekb/domain";
import { SocialDesktop } from "./social-desktop";
import { MessageThread } from "./message-thread";
import { installBrowserStorage } from "@/test/browser-storage";
import { notifyIdentityChanged } from "@/lib/member/identity-events";
import { setSocialSound } from "@/hooks/use-social-sound";

const fixture = vi.hoisted(() => ({ client: {} as Record<string, unknown>, uploads: [] as File[], reads: [] as number[], sends: [] as string[], rows: [] as DirectMessage[], connections: [] as FriendshipConnection[], conversations: [] as DirectConversation[], identities: [] as Record<string, unknown>[], audio: 0,
  students: [] as Record<string, unknown>[],
  actorId: "actor" as string | null, authChanged: (() => {}) as (event: string, session: { user: { id: string } } | null) => void, deferredFriends: null as (() => Promise<unknown>) | null,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => fixture.client }));
vi.mock("@/hooks/use-member-presence", () => ({ useMemberPresence: () => new Set() }));
vi.mock("@/lib/member/chat-stickers", async (original) => ({ ...await original<typeof import("@/lib/member/chat-stickers")>(), uploadChatSticker: async (_client: unknown, owner: string, file: File) => { fixture.uploads.push(file); return { id: "sticker", owner_id: owner, storage_path: "test.png", label: file.name, mime_type: "image/png", created_at: "2026-09-01" }; } }));
vi.mock("@/lib/member/friends-api-client", () => ({
  readFriends: async () => fixture.deferredFriends ? fixture.deferredFriends() : ({ actor: { id: fixture.actorId, public_uid: 12345, display_name: fixture.actorId === "actor" ? "我" : "账号B", avatar_url: null, nameplate_style: "classic" }, connections: fixture.connections, conversations: fixture.conversations }),
  runFriendAction: async ({ action }: { action: string }) => {
    if (action === "search") return { profile: { id: "friend", public_uid: 12346, display_name: "好友", avatar_url: null, nameplate_style: "classic" } };
    if (action === "conversation") return { conversationId: "chat" };
    throw new Error("unexpected mutation");
  },
}));
const conversation = { conversation_id: "chat", other_id: "friend", display_name: "好友", avatar_url: null, public_uid: 12346, nameplate_style: "classic", unread_count: 1, last_message: "hello", last_message_at: "2026-09-01" } as DirectConversation;
function message(id: number): DirectMessage { return { id, sender_id: "friend", body: `消息 ${id}`, created_at: "2026-09-01T00:00:00Z" } as DirectMessage; }
async function tick(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function openDesktop() {
  render(<SocialDesktop />); await tick();
  act(() => { window.dispatchEvent(new CustomEvent("wavekb:open-chat", { detail: { conversation } })); });
  await tick();
  return screen.getByRole("region", { name: "与好友聊天" });
}
beforeEach(() => {
  installBrowserStorage(); localStorage.clear(); vi.useFakeTimers();
  setSocialSound(true);
  fixture.uploads = []; fixture.reads = []; fixture.sends = []; fixture.rows = [message(1)]; fixture.connections = []; fixture.conversations = []; fixture.identities = []; fixture.audio = 0;
  fixture.actorId = "actor"; fixture.deferredFriends = null; fixture.students = [];
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("AudioContext", class { constructor() { fixture.audio++; } createOscillator() { return { frequency: { value: 0 }, connect: () => ({ connect() {} }), start() {}, stop() {}, addEventListener() {} }; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; } });
  fixture.client = {
    auth: { getSession: async () => ({ data: { session: fixture.actorId ? { user: { id: fixture.actorId } } : null } }), onAuthStateChange: (callback: typeof fixture.authChanged) => { fixture.authChanged = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "get_public_post_profiles") return { data: fixture.identities.filter((row) => (args.p_ids as string[]).includes(String(row.id))), error: null };
      if (name === "list_my_mentor_students") return { data: fixture.students, error: null };
      if (name === "mark_conversation_read_v1") fixture.reads.push(Number(args.p_through_id));
      if (name === "send_direct_message") fixture.sends.push(String(args.p_body));
      return { data: name.startsWith("list_conversation_messages") ? fixture.rows.filter((row) => row.id > Number(args.p_after_id || 0)) : [], error: null };
    },
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["floating", "full-page"])("%s accepts a protected-mode file drag and stages the dropped image without sending", async (surface) => {
  const root = surface === "floating" ? await openDesktop() : render(<MessageThread actorId="actor" conversation={conversation} initialMessages={[]} initialCustomStickers={[]} />).container;
  const form = root.querySelector("form")!;
  const protectedTransfer = { types: ["Files"], files: [], items: [{ kind: "file", type: "image/png", getAsFile: () => null }] };
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: protectedTransfer }); fireEvent(form, event);
  expect(event.defaultPrevented).toBe(true);
  const file = new File(["image"], "screenshot.png", { type: "" });
  fireEvent.drop(form, { dataTransfer: { types: ["Files"], files: [file], items: [] } }); await tick();
  expect(fixture.uploads).toEqual([file]); expect(fixture.sends).toEqual([]);
  expect(within(root as HTMLElement).getByText(/待发送：screenshot.png/)).toBeDefined();
});

it("does not mark messages read after minimizing an already mounted chat", async () => {
  const root = await openDesktop(); fixture.reads = [];
  fireEvent.click(within(root).getByRole("button", { name: "最小化" }));
  fixture.rows = [message(1), message(2)]; await tick(6000);
  expect(fixture.reads).toEqual([]);
});

it("does not mark an initially hidden conversation read", async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await openDesktop(); expect(fixture.reads).toEqual([]);
});

it("keeps the history scroll position through an unchanged poll and an incoming message", async () => {
  const root = await openDesktop();
  const scroller = root.querySelector('[aria-live="polite"]')!;
  Object.defineProperties(scroller, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 }, scrollTop: { configurable: true, writable: true, value: 100 } });
  fireEvent.scroll(scroller); vi.mocked(Element.prototype.scrollIntoView).mockClear();
  await tick(6000); expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  fixture.rows = [message(1), message(2)]; await tick(6000);
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});

it("uses the latest sound toggle during an existing floating chat's polling", async () => {
  await openDesktop(); fireEvent.click(screen.getByRole("button", { name: "关闭提示音" }));
  fixture.rows = [message(1), message(2)]; await tick(6000);
  expect(fixture.audio).toBe(0);
});

it("keeps mute effective when storage is readable but its write quota is exhausted", async () => {
  await openDesktop();
  const originalWrite = localStorage.setItem.bind(localStorage);
  vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => { if (key === "wavekb:social-sound:v1") throw new Error("QuotaExceededError"); originalWrite(key, value); });
  fireEvent.click(screen.getByRole("button", { name: "关闭提示音" }));
  fixture.rows = [message(1), message(2)]; await tick(6000);
  expect(fixture.audio).toBe(0);
  expect(screen.getByRole("button", { name: "开启提示音" })).toBeDefined();
});

it.each([null, "actor-b"])("does not let an old account response restore chats after switching to %s", async (nextActor) => {
  fixture.conversations = [conversation];
  await openDesktop();
  let completeOldRead!: (value: unknown) => void;
  fixture.deferredFriends = () => new Promise((resolve) => { completeOldRead = resolve; });
  await tick(9000);
  fixture.deferredFriends = null; fixture.actorId = nextActor; fixture.conversations = [];
  act(() => fixture.authChanged(nextActor ? "SIGNED_IN" : "SIGNED_OUT", nextActor ? { user: { id: nextActor } } : null));
  await tick();
  await act(async () => { completeOldRead({ actor: { id: "actor", public_uid: 12345, display_name: "旧账号", avatar_url: null, nameplate_style: "classic" }, connections: [], conversations: [conversation] }); });
  expect(screen.queryByRole("region", { name: "与好友聊天" })).toBeNull();
  expect(screen.queryByText("旧账号")).toBeNull();
  expect(screen.queryByText("hello")).toBeNull();
  if (nextActor) expect(screen.getByText("账号B")).toBeDefined();
});

it("honors the shared mute preference in full-page conversations", async () => {
  localStorage.setItem("wavekb:social-sound:v1", "off");
  render(<MessageThread actorId="actor" conversation={conversation} initialMessages={[message(1)]} initialCustomStickers={[]} />);
  fixture.rows = [message(1), message(2)]; await tick(7000); expect(fixture.audio).toBe(0);
});

it("offers chat instead of another request for an accepted friend found by UID", async () => {
  fixture.connections = [{ friendship_id: "friendship", other_id: "friend", status: "accepted", direction: "outgoing", display_name: "好友", public_uid: 12346, avatar_url: null, nameplate_style: "classic" } as FriendshipConnection];
  render(<SocialDesktop />); await tick();
  fireEvent.click(screen.getByRole("button", { name: "新朋友" }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索好友 UID" }), { target: { value: "12346" } });
  fireEvent.click(screen.getByRole("button", { name: "搜索" })); await tick();
  expect(screen.queryByRole("button", { name: "添加" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "聊天" })); await tick();
  expect(screen.getByRole("region", { name: "与好友聊天" })).toBeDefined();
});

it("refreshes an open conversation's identity without restoring a minimized window", async () => {
  const root = await openDesktop(); fireEvent.click(within(root).getByRole("button", { name: "最小化" }));
  fixture.conversations = [{ ...conversation, display_name: "新昵称", avatar_url: "https://example.test/new.png", nameplate_style: "rainbow" }];
  await tick(9000);
  const refreshed = screen.getByRole("region", { name: "与新昵称聊天" });
  expect(refreshed.getAttribute("data-minimized")).toBe("true");
  expect(within(refreshed).getByRole("img", { name: "新昵称的头像" }).getAttribute("src")).toBe("https://example.test/new.png");
});

it("uses the member's nameplate in recent conversations", async () => {
  fixture.conversations = [{ ...conversation, nameplate_style: "rainbow" }];
  render(<SocialDesktop />); await tick();
  const row = document.querySelector("[data-conversation-row]") as HTMLElement;
  expect(within(row).getByText("好友").getAttribute("data-nameplate")).toBe("rainbow");
});

it("uses the member's nameplate in friend requests", async () => {
  fixture.connections = [{ friendship_id: "request", other_id: "friend", status: "pending", direction: "incoming", display_name: "申请者", public_uid: 12346, avatar_url: null, nameplate_style: "rainbow" } as FriendshipConnection];
  render(<SocialDesktop />); await tick();
  fireEvent.click(screen.getByRole("button", { name: /^新朋友/ }));
  expect(screen.getByText("申请者").getAttribute("data-nameplate")).toBe("rainbow");
});

it.each(["recent", "notification", "student"])("shows a readable sticker summary in the %s list", async (surface) => {
  fixture.conversations = [{ ...conversation, last_message: "[[sticker:diamond]]" }];
  if (surface === "student") { fixture.conversations = []; fixture.students = [{ thread_id: "student-thread", display_name: "学生", avatar_url: null, nameplate_style: "classic", last_message: "[[sticker:diamond]]" }]; }
  render(<SocialDesktop />); await tick();
  if (surface === "notification") fireEvent.click(screen.getByRole("button", { name: /^消息/ }));
  expect(screen.getByText("💎 高质量")).toBeDefined();
  expect(screen.queryByText("[[sticker:diamond]]")).toBeNull();
});

it.each(["floating", "full-page"])("%s leaves malformed custom sticker tokens as text", async (surface) => {
  fixture.rows = [{ ...message(1), body: "[[custom-sticker:..%2Fprivate.svg|not-a-sticker]]" }];
  const root = surface === "floating" ? await openDesktop() : render(<MessageThread actorId="actor" conversation={conversation} initialMessages={fixture.rows} initialCustomStickers={[]} />).container;
  expect(within(root as HTMLElement).queryByRole("img", { name: "not-a-sticker" })).toBeNull();
  expect(within(root as HTMLElement).getByText("[[custom-sticker:..%2Fprivate.svg|not-a-sticker]]")).toBeDefined();
});

it("marks the full-page conversation read when a hidden tab becomes visible with no new messages", async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  render(<MessageThread actorId="actor" conversation={conversation} initialMessages={[message(1)]} initialCustomStickers={[]} />); await tick();
  expect(fixture.reads).toEqual([]);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); }); await tick();
  expect(fixture.reads).toEqual([1]);
});

it("follows new full-page messages only when already near the bottom", async () => {
  const root = render(<MessageThread actorId="actor" conversation={conversation} initialMessages={[message(1)]} initialCustomStickers={[]} />).container;
  await tick(); vi.mocked(Element.prototype.scrollIntoView).mockClear();
  fixture.rows = [message(1), message(2)]; await tick(7000);
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  const scroller = root.querySelector('[aria-live="polite"]')!;
  Object.defineProperties(scroller, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 }, scrollTop: { configurable: true, writable: true, value: 100 } });
  fireEvent.scroll(scroller); vi.mocked(Element.prototype.scrollIntoView).mockClear(); fixture.reads = [];
  fixture.rows = [message(1), message(2), message(3)]; await tick(7000);
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled(); expect(fixture.reads).toEqual([]);
});

it.each(["floating", "full-page"])("%s refreshes an invalidated identity from the authoritative public profile", async (surface) => {
  const root = surface === "floating" ? await openDesktop() : render(<MessageThread actorId="actor" conversation={conversation} initialMessages={[]} initialCustomStickers={[]} />).container;
  fixture.identities = [{ id: "friend", display_name: "新昵称", avatar_url: "https://example.test/changed.png", public_uid: 12346, display_title: "", nameplate_style: "rainbow" }];
  act(() => { notifyIdentityChanged("friend"); }); await tick();
  expect(within(root as HTMLElement).getByRole("img", { name: "新昵称的头像" }).getAttribute("src")).toBe("https://example.test/changed.png");
});

it("updates the sound control on a cross-tab preference change", async () => {
  await openDesktop();
  localStorage.setItem("wavekb:social-sound:v1", "off");
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "wavekb:social-sound:v1", newValue: "off" })); });
  expect(screen.getByRole("button", { name: "开启提示音" })).toBeDefined();
});

it.each(["floating", "full-page"])("%s keeps emoji selection in the draft until explicit send", async (surface) => {
  const root = surface === "floating" ? await openDesktop() : render(<MessageThread actorId="actor" conversation={conversation} initialMessages={[]} initialCustomStickers={[]} />).container;
  if (surface === "floating") fireEvent.click(within(root as HTMLElement).getByRole("button", { name: "表情" }));
  fireEvent.click(within(root as HTMLElement).getByRole("button", { name: surface === "floating" ? "🌊" : "加入波浪" }));
  await tick();
  expect((within(root as HTMLElement).getByRole("textbox") as HTMLTextAreaElement).value).toBe("🌊");
  expect(fixture.sends).toEqual([]);
});

it.each(["floating", "full-page"])("%s stages clipboard images without sending and rejects unsupported file drops", async (surface) => {
  const root = surface === "floating" ? await openDesktop() : render(<MessageThread actorId="actor" conversation={conversation} initialMessages={[]} initialCustomStickers={[]} />).container;
  const file = new File(["image"], "clipboard.png", { type: "image/png" });
  fireEvent.paste(within(root as HTMLElement).getByRole("textbox"), { clipboardData: { files: [], items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });
  await tick(); expect(fixture.uploads).toEqual([file]); expect(fixture.sends).toEqual([]);
  fireEvent.drop(root.querySelector("form")!, { dataTransfer: { types: ["Files"], files: [new File(["text"], "notes.txt", { type: "text/plain" })], items: [] } });
  await tick(); expect(fixture.uploads).toEqual([file]); expect(fixture.sends).toEqual([]);
  expect(within(root as HTMLElement).getByRole("alert").textContent).toContain("PNG");
});

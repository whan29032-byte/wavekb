import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { AccountNavigation } from "./account-navigation";
import { notifyIdentityChanged } from "@/lib/member/identity-events";
import { installBrowserStorage } from "@/test/browser-storage";
const mocks = vi.hoisted(() => ({ read: vi.fn(), auth: vi.fn(), session: vi.fn(), unsubscribe: vi.fn(), link: vi.fn(), pathname: "/community/idea_sharing" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({}), usePathname: () => mocks.pathname }));
vi.mock("next/link", () => ({ default: ({ prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean | null }) => {
  mocks.link({ prefetch, ...props });
  return <a {...props} />;
} }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: mocks.read,
  auth: { getSession: mocks.session, onAuthStateChange: mocks.auth },
}) }));
beforeEach(() => {
  installBrowserStorage();
  mocks.pathname = "/community/idea_sharing";
  mocks.read.mockReset(); mocks.session.mockReset(); mocks.auth.mockReset();
  mocks.session.mockResolvedValue({ data: { session: { user: { id: "owner" } } } });
  mocks.auth.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it.each(["/knowledge", "/knowledge/core-full-book", "/knowledge/books/elliott-wave-principle-eleventh-edition"])("does not prefetch the anonymous login link while reading %s", async (pathname) => {
  mocks.pathname = pathname;
  mocks.session.mockResolvedValue({ data: { session: null } });
  render(<AccountNavigation />);
  const link = await screen.findByRole("link", { name: "登录" });
  expect(link.getAttribute("href")).toBe("/login");
  const loginCalls = mocks.link.mock.calls.filter(([props]) => props.href === "/login");
  expect(loginCalls.length).toBeGreaterThan(0);
  expect(loginCalls.every(([props]) => props.prefetch === false)).toBe(true);
});

it("does not prefetch either authenticated personal link while reading", async () => {
  mocks.pathname = "/knowledge/books/elliott-wave-principle-eleventh-edition";
  mocks.read.mockResolvedValue({ data: [{ id: "owner", public_uid: 12345, nameplate_style: "blackgold" }], error: null });
  render(<AccountNavigation />);
  await waitFor(() => expect(screen.getAllByLabelText("UID 12345")).toHaveLength(2));
  expect(screen.getAllByLabelText("UID 12345").every((element) => element.closest("a")?.getAttribute("href") === "/member/12345")).toBe(true);
  const profileCalls = mocks.link.mock.calls.filter(([props]) => props.href === "/member/12345");
  expect(profileCalls.length).toBeGreaterThanOrEqual(2);
  expect(profileCalls.every(([props]) => props.prefetch === false)).toBe(true);
});

it("preserves the anonymous login link's default prefetch policy outside reading", async () => {
  mocks.session.mockResolvedValue({ data: { session: null } });
  render(<AccountNavigation />);
  expect((await screen.findByRole("link", { name: "登录" })).getAttribute("href")).toBe("/login");
  const loginCalls = mocks.link.mock.calls.filter(([props]) => props.href === "/login");
  expect(loginCalls.length).toBeGreaterThan(0);
  expect(loginCalls.every(([props]) => props.prefetch === undefined)).toBe(true);
});

it("preserves authenticated personal links' default prefetch policy outside reading", async () => {
  mocks.read.mockResolvedValue({ data: [{ id: "owner", public_uid: 12345, nameplate_style: "blackgold" }], error: null });
  render(<AccountNavigation />);
  await waitFor(() => expect(screen.getAllByLabelText("UID 12345")).toHaveLength(2));
  const profileCalls = mocks.link.mock.calls.filter(([props]) => props.href === "/member/12345");
  expect(profileCalls.length).toBeGreaterThanOrEqual(2);
  expect(profileCalls.every(([props]) => props.prefetch === undefined)).toBe(true);
});

it("shows an accessible bounded account placeholder until the initial session resolves", async () => {
  let finishSession!: (result: unknown) => void;
  mocks.session.mockReturnValue(new Promise((resolve) => { finishSession = resolve; }));
  render(<AccountNavigation />);
  expect(screen.getByRole("status").textContent).toContain("正在加载账号");
  expect(screen.getByRole("status").className).toContain("w-28");
  expect(screen.queryByRole("link", { name: "登录" })).toBeNull();
  await act(async () => { finishSession({ data: { session: null } }); });
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("link", { name: "登录" })).toBeDefined();
});

it("ends account loading when session retrieval fails", async () => {
  mocks.session.mockRejectedValue(new Error("session unavailable"));
  render(<AccountNavigation />);
  await waitFor(() => expect(screen.getByRole("link", { name: "登录" })).toBeDefined());
  expect(screen.queryByRole("status")).toBeNull();
});

it("ends account loading when session setup throws synchronously", async () => {
  mocks.session.mockImplementation(() => { throw new Error("client unavailable"); });
  render(<AccountNavigation />);
  await waitFor(() => expect(screen.getByRole("link", { name: "登录" })).toBeDefined());
  expect(screen.queryByRole("status")).toBeNull();
});

it("re-reads current identity after equipment changes without requiring a new login", async () => {
  mocks.auth.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.read.mockResolvedValue({ data: [{ id: "owner", public_uid: 12345, nameplate_style: "blackgold" }], error: null });
  render(<AccountNavigation />);
  await waitFor(() => expect(screen.getAllByLabelText("UID 12345")[0].getAttribute("data-nameplate")).toBe("blackgold"));
  mocks.read.mockResolvedValue({ data: [{ id: "owner", public_uid: 12345, nameplate_style: "rainbow" }], error: null });
  act(() => notifyIdentityChanged("owner"));
  await waitFor(() => expect(screen.getAllByLabelText("UID 12345")[0].getAttribute("data-nameplate")).toBe("rainbow"));
});

it("keeps the account link and equipped nameplate when production only has the legacy public identity RPC", async () => {
  mocks.read.mockImplementation(async (name, args) => {
    if (name === "get_public_post_profiles") return { data: null, error: { code: "PGRST202" } };
    if (name === "get_public_profiles" && args.p_ids[0] === "owner") return { data: [{ id: "owner", public_uid: 33333, display_name: "研究者", avatar_url: null }], error: null };
    if (name === "search_profile_by_uid" && args.p_uid === 33333) return { data: [{ id: "owner", public_uid: 33333, display_name: "研究者", avatar_url: null, nameplate_style: "blackgold", display_title: "波浪研究者", role: "member" }], error: null };
    throw new Error("Unexpected identity query");
  });
  render(<AccountNavigation />);
  await waitFor(() => expect(screen.getAllByLabelText("UID 33333")[0].getAttribute("data-nameplate")).toBe("blackgold"));
  expect(screen.getAllByLabelText("UID 33333")[0].closest("a")?.getAttribute("href")).toBe("/member/33333");
});

it("keeps a newer auth event when the initial session lookup resolves with the previous account", async () => {
  let finishSession!: (result: unknown) => void;
  mocks.session.mockReturnValue(new Promise((resolve) => { finishSession = resolve; }));
  mocks.read.mockImplementation(async (_name, { p_ids }) => ({ data: [{ id: p_ids[0], public_uid: p_ids[0] === "new-owner" ? 23456 : 12345, nameplate_style: "classic" }], error: null }));
  render(<AccountNavigation />);
  await act(async () => { mocks.auth.mock.calls[0][0]("SIGNED_IN", { user: { id: "new-owner" } }); });
  await waitFor(() => expect(screen.getAllByLabelText("UID 23456")).toHaveLength(2));
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => { finishSession({ data: { session: { user: { id: "owner" } } } }); });
  expect(screen.queryAllByLabelText("UID 12345")).toEqual([]);
  expect(screen.getAllByLabelText("UID 23456")).toHaveLength(2);
});

it("retains verified equipment on a temporary refresh failure and does not leak it into another account", async () => {
  mocks.read.mockResolvedValue({ data: [{ id: "owner", public_uid: 33333, nameplate_style: "blackgold" }], error: null });
  render(<AccountNavigation />);
  await waitFor(() => expect(screen.getAllByLabelText("UID 33333")[0].getAttribute("data-nameplate")).toBe("blackgold"));
  mocks.read.mockResolvedValue({ data: null, error: { code: "503" } });
  await act(async () => { notifyIdentityChanged("owner"); });
  expect(screen.getAllByLabelText("UID 33333")[0].getAttribute("data-nameplate")).toBe("blackgold");
  await act(async () => { mocks.auth.mock.calls[0][0]("SIGNED_IN", { user: { id: "different-owner" } }); });
  expect(screen.queryAllByLabelText("UID 33333")).toEqual([]);
});

it("does not restore an old profile response after logout or into a new account", async () => {
  let finishProfile!: (result: unknown) => void;
  mocks.read.mockReturnValueOnce(new Promise((resolve) => { finishProfile = resolve; }));
  render(<AccountNavigation />);
  await waitFor(() => expect(mocks.read).toHaveBeenCalledWith("get_public_post_profiles", { p_ids: ["owner"] }));
  await act(async () => { mocks.auth.mock.calls[0][0]("SIGNED_OUT", null); });
  expect(screen.getByRole("link", { name: "登录" })).toBeDefined();
  await act(async () => { finishProfile({ data: [{ id: "owner", public_uid: 12345, nameplate_style: "blackgold" }], error: null }); });
  expect(screen.getByRole("link", { name: "登录" })).toBeDefined();
  expect(screen.queryAllByLabelText("UID 12345")).toEqual([]);
  mocks.read.mockReturnValue(new Promise(() => {}));
  await act(async () => { mocks.auth.mock.calls[0][0]("SIGNED_IN", { user: { id: "new-owner" } }); });
  expect(screen.queryAllByLabelText("UID 12345")).toEqual([]);
});

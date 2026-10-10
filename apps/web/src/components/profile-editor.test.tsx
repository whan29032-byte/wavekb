import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProfileEditor } from "./profile-editor";
import story from "./profile-editor.stories";
import { installBrowserStorage } from "@/test/browser-storage";

const fixture = vi.hoisted(() => ({ client: {} as Record<string, unknown>, rpc: vi.fn(), read: vi.fn(), upload: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => fixture.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: fixture.refresh }) }));
vi.mock("@/lib/env", () => ({ publicSupabaseConfig: () => ({ url: "https://offline.test", anonKey: "offline" }) }));
const profile = story.args.profile;
const publicUrl = (path: string) => `https://offline.test/storage/v1/object/public/profile-avatars/${path}`;

beforeEach(() => {
  installBrowserStorage();
  [fixture.rpc, fixture.read, fixture.upload, fixture.remove, fixture.refresh].forEach((mock) => mock.mockReset());
  fixture.upload.mockResolvedValue({ error: null });
  fixture.remove.mockResolvedValue({ error: null });
  fixture.rpc.mockResolvedValue({ error: new Error("fetch response lost") });
  const query = { eq: vi.fn().mockReturnThis(), maybeSingle: fixture.read };
  fixture.client = {
    auth: { getUser: async () => ({ data: { user: { id: profile.id } }, error: null }) },
    rpc: fixture.rpc,
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
    storage: { from: () => ({ upload: fixture.upload, remove: fixture.remove, getPublicUrl: (path: string) => ({ data: { publicUrl: publicUrl(path) } }) }) },
  };
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:offline-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function submitCover() {
  const { container } = render(<ProfileEditor profile={profile} initialNameplates={[]} />);
  fireEvent.change(screen.getByLabelText("个人页背景"), { target: { files: [new File(["image"], "cover.png", { type: "image/png" })] } });
  fireEvent.submit(container.querySelector("form")!);
  return container.querySelector("form")!;
}

it("recovers a lost acknowledgement only after the profile and new image reference match", async () => {
  let finishRead!: (value: unknown) => void;
  fixture.read.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
  submitCover();
  await waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(1));
  expect(fixture.remove).not.toHaveBeenCalled();
  const path = String(fixture.upload.mock.calls[0][0]);
  finishRead({ data: { ...profile, cover_url: publicUrl(path) }, error: null });
  await screen.findByText("资料已保存。");
  expect(fixture.remove).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["unavailable", "old snapshot", "incomplete references"])("preserves uploaded images and input when the save readback is %s", async (state) => {
  if (state === "incomplete references") fixture.rpc.mockResolvedValue({ error: { code: "P0001", message: "rejected" } });
  fixture.read.mockResolvedValue(state === "unavailable" ? { data: null, error: new Error("offline") } : { data: state === "incomplete references" ? { id: profile.id } : profile, error: null });
  const form = submitCover();
  expect((await screen.findByRole("alert")).textContent).toContain("尚未确认");
  expect(fixture.remove).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "保存资料" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("link", { name: "在新窗口核对资料，保留当前编辑页" })).toBeDefined();
  await act(async () => { fireEvent.submit(form); });
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
});

it("cleans a rejected upload only after a definite database rollback and a reference-free profile read", async () => {
  fixture.rpc.mockResolvedValue({ error: { code: "P0001", message: "invalid profile" } });
  fixture.read.mockResolvedValue({ data: profile, error: null });
  submitCover();
  await screen.findByRole("alert");
  expect(fixture.read).toHaveBeenCalledTimes(1);
  expect(fixture.remove).toHaveBeenCalledWith([fixture.upload.mock.calls[0][0]]);
  expect((screen.getByRole("button", { name: "保存资料" }) as HTMLButtonElement).disabled).toBe(false);
});

it("does not delete a referenced image on an explicit error with mismatched profile fields", async () => {
  fixture.rpc.mockResolvedValue({ error: { code: "P0001", message: "rejected" } });
  fixture.read.mockImplementation(async () => ({ data: { ...profile, display_name: "其他修改", cover_url: publicUrl(String(fixture.upload.mock.calls[0][0])) }, error: null }));
  submitCover();
  expect((await screen.findByRole("alert")).textContent).toContain("尚未确认");
  expect(fixture.remove).not.toHaveBeenCalled();
});

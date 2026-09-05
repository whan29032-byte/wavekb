import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installBrowserStorage } from "@/test/browser-storage";
import { ProfileEditor } from "./profile-editor";
import story from "./profile-editor.stories";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), refresh: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
beforeEach(() => { installBrowserStorage(); mocks.rpc.mockReset(); mocks.refresh.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("updates the hero and invalidates other identity consumers only after equip succeeds", async () => {
  mocks.rpc.mockResolvedValue({ data: { equipped: true, style: "rainbow" }, error: null });
  const invalidated = vi.fn(); window.addEventListener("wavekb:identity:changed", invalidated);
  const { container } = render(<ProfileEditor profile={story.args.profile} initialNameplates={[{ ...story.args.initialNameplates[0], style: "rainbow", equipped: false, expires_at: "2099-01-01" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "佩戴" }));
  await waitFor(() => expect(container.querySelector(".profile-hero .identity-nameplate")?.getAttribute("data-nameplate")).toBe("rainbow"));
  expect(container.querySelector(".profile-hero .identity-avatar-frame")?.getAttribute("data-nameplate")).toBe("rainbow");
  expect(invalidated).toHaveBeenCalledTimes(1); expect(mocks.refresh).toHaveBeenCalledTimes(1);
  window.removeEventListener("wavekb:identity:changed", invalidated);
});
it("does not save one person's editor into a different signed-in account", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "different-owner" } }, error: null });
  const { container } = render(<ProfileEditor profile={story.args.profile} initialNameplates={[]} />);
  fireEvent.submit(container.querySelector("form")!);
  await screen.findByRole("alert");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("reflects refreshed equipment props without overwriting the unsaved profile form", () => {
  const { container, rerender } = render(<ProfileEditor profile={story.args.profile} initialNameplates={[]} />);
  const name = screen.getByLabelText("昵称");
  fireEvent.change(name, { target: { value: "尚未保存的名字" } });
  rerender(<ProfileEditor profile={{ ...story.args.profile, nameplate_style: "rainbow" }} initialNameplates={[]} />);
  expect(container.querySelector(".profile-hero .identity-nameplate")?.getAttribute("data-nameplate")).toBe("rainbow");
  expect((name as HTMLInputElement).value).toBe("尚未保存的名字");
});
it("refreshes owned nameplates while retaining the same owner's unsaved profile text", () => {
  const { rerender } = render(<ProfileEditor profile={story.args.profile} initialNameplates={[]} />);
  fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "未保存草稿" } });
  rerender(<ProfileEditor profile={story.args.profile} initialNameplates={[{ ...story.args.initialNameplates[0], product_name: "新兑换铭牌", equipped: true, expires_at: "2099-01-01" }]} />);
  expect(screen.getByText("新兑换铭牌")).toBeDefined();
  expect((screen.getByRole("button", { name: "当前佩戴" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("昵称") as HTMLInputElement).value).toBe("未保存草稿");
});
it("isolates the whole profile draft when the server switches account", () => {
  const { rerender } = render(<ProfileEditor profile={story.args.profile} initialNameplates={[]} />);
  fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "账号A私有草稿" } });
  rerender(<ProfileEditor profile={{ ...story.args.profile, id: "account-b", display_name: "账号B" }} initialNameplates={[]} />);
  expect((screen.getByLabelText("昵称") as HTMLInputElement).value).toBe("账号B");
  expect(screen.queryByText("账号A私有草稿")).toBeNull();
});

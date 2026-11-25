import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireActiveMember: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: auth.requireActiveMember }));

import DiscordLinkPage from "./page";

const token = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";

beforeEach(() => {
  auth.requireActiveMember.mockReset().mockResolvedValue({ id: "internal", publicUid: 583104 });
});
afterEach(cleanup);

describe("Discord account link page", () => {
  it("preserves a valid token through login and renders a server-side confirmation form", async () => {
    render(await DiscordLinkPage({ searchParams: Promise.resolve({ token }) }));

    expect(auth.requireActiveMember).toHaveBeenCalledWith(
      `/account/discord-link?token=${encodeURIComponent(token)}`,
    );
    expect(screen.getByText(/UID 583104/)).toBeDefined();
    const button = screen.getByRole("button", { name: "确认绑定 Discord" });
    const form = button.closest("form");
    expect(form?.getAttribute("action")).toBe("/api/integrations/discord/redeem");
    expect(form?.getAttribute("method")).toBe("post");
    expect((form?.querySelector('input[name="token"]') as HTMLInputElement).value).toBe(token);
  });

  it("shows success without retaining the raw token or another confirmation form", async () => {
    const { container } = render(await DiscordLinkPage({
      searchParams: Promise.resolve({ status: "linked" }),
    }));
    expect(screen.getByText("Discord 账号已绑定")).toBeDefined();
    expect(screen.queryByRole("button", { name: "确认绑定 Discord" })).toBeNull();
    expect(container.innerHTML).not.toContain("token=");
  });

  it("rejects a malformed token before presenting a confirmation action", async () => {
    render(await DiscordLinkPage({ searchParams: Promise.resolve({ token: "not-valid" }) }));
    expect(screen.getByText("绑定链接无效")).toBeDefined();
    expect(screen.queryByRole("button", { name: "确认绑定 Discord" })).toBeNull();
  });
});

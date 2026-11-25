import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  requireActiveMember: vi.fn(),
}));
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: auth.getCurrentUser,
  requireActiveMember: auth.requireActiveMember,
}));

import DiscordLinkPage, { metadata } from "./page";

const token = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const storageKey = "wavekb.discord-link-token.v1";

beforeEach(() => {
  auth.getCurrentUser.mockReset().mockResolvedValue({ id: "internal" });
  auth.requireActiveMember.mockReset().mockResolvedValue({ id: "internal", publicUid: 583104 });
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/account/discord-link");
});
afterEach(cleanup);

describe("Discord account link page", () => {
  it("moves a valid fragment token into tab storage and removes it from the address bar", async () => {
    window.history.replaceState({}, "", `/account/discord-link#token=${token}`);
    render(await DiscordLinkPage({ searchParams: Promise.resolve({}) }));

    const button = await screen.findByRole("button", { name: "确认绑定 Discord" });
    const form = button.closest("form");
    expect(auth.requireActiveMember).toHaveBeenCalledWith("/account/discord-link");
    expect(screen.getByText(/UID 583104/)).toBeDefined();
    expect((form?.querySelector('input[name="token"]') as HTMLInputElement).value).toBe(token);
    expect(window.sessionStorage.getItem(storageKey)).toBe(token);
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(token);
  });

  it("keeps the token in tab storage while an unauthenticated user goes to login", async () => {
    auth.getCurrentUser.mockResolvedValue(null);
    window.history.replaceState({}, "", `/account/discord-link#token=${token}`);
    render(await DiscordLinkPage({ searchParams: Promise.resolve({}) }));

    const login = await screen.findByRole("link", { name: "登录后继续" });
    expect(login.getAttribute("href")).toBe("/login?next=%2Faccount%2Fdiscord-link");
    expect(window.sessionStorage.getItem(storageKey)).toBe(token);
    expect(window.location.hash).toBe("");
    expect(auth.requireActiveMember).not.toHaveBeenCalled();
  });

  it("clears the tab token after a stable result and never renders another confirmation", async () => {
    window.sessionStorage.setItem(storageKey, token);
    render(await DiscordLinkPage({ searchParams: Promise.resolve({ status: "linked" }) }));

    await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toBeNull());
    expect(screen.queryByRole("button", { name: "确认绑定 Discord" })).toBeNull();
  });

  it("rejects and clears a malformed fragment before presenting a confirmation action", async () => {
    window.history.replaceState({}, "", "/account/discord-link#token=not-valid");
    render(await DiscordLinkPage({ searchParams: Promise.resolve({}) }));

    expect(await screen.findByText("绑定链接无效")).toBeDefined();
    expect(screen.queryByRole("button", { name: "确认绑定 Discord" })).toBeNull();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("declares no-referrer metadata for the sensitive handoff page", () => {
    expect(metadata.referrer).toBe("no-referrer");
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  requireActiveMember: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: auth.getCurrentUser,
  requireActiveMember: auth.requireActiveMember,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

import DiscordLinkPage, { metadata } from "./page";

const token = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const storageKey = "wavekb.discord-link-token.v1";

beforeEach(() => {
  auth.getCurrentUser.mockReset().mockResolvedValue({ id: "internal" });
  auth.requireActiveMember.mockReset().mockResolvedValue({ id: "internal", publicUid: 583104 });
  navigation.replace.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/account/discord-link");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it("redeems through a same-origin fetch before navigating to the server result", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      redirected: false,
      json: async () => ({ redirectTo: "/account/discord-link?status=linked" }),
    });
    vi.stubGlobal("fetch", fetcher);
    window.history.replaceState({}, "", `/account/discord-link#token=${token}`);
    render(await DiscordLinkPage({ searchParams: Promise.resolve({}) }));

    fireEvent.click(await screen.findByRole("button", { name: /Discord$/ }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(
      "/account/discord-link?status=linked",
    ));
    expect(fetcher).toHaveBeenCalledWith(
      "/api/integrations/discord/redeem",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
      }),
    );
    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(request.body?.toString()).toBe(`token=${token}`);
  });

  it.each([
    "//attacker.example/collect",
    `/\\${window.location.host}//attacker.example/collect`,
  ])("refuses an unsafe JSON redemption destination: %s", async (redirectTo) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      redirected: false,
      json: async () => ({ redirectTo }),
    }));
    window.history.replaceState({}, "", `/account/discord-link#token=${token}`);
    render(await DiscordLinkPage({ searchParams: Promise.resolve({}) }));

    fireEvent.click(await screen.findByRole("button", { name: /Discord$/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("绑定请求没有完成");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("keeps the token available while routing an expired session back through login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      redirected: false,
      json: async () => ({ redirectTo: "/login?next=%2Faccount%2Fdiscord-link" }),
    }));
    window.history.replaceState({}, "", `/account/discord-link#token=${token}`);
    render(await DiscordLinkPage({ searchParams: Promise.resolve({}) }));

    fireEvent.click(await screen.findByRole("button", { name: /Discord$/ }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(
      "/login?next=%2Faccount%2Fdiscord-link",
    ));
    expect(window.sessionStorage.getItem(storageKey)).toBe(token);
  });

  it("leaves the confirmation retryable when redemption fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failed")));
    window.history.replaceState({}, "", `/account/discord-link#token=${token}`);
    render(await DiscordLinkPage({ searchParams: Promise.resolve({}) }));

    const button = await screen.findByRole("button", { name: /Discord$/ });
    fireEvent.click(button);

    expect((await screen.findByRole("alert")).textContent).toContain("绑定请求没有完成");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(window.sessionStorage.getItem(storageKey)).toBe(token);
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

import { afterEach, describe, expect, it, vi } from "vitest";
import LiveMarketPage from "./page";

const { member } = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ requireActiveMember: member }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));

afterEach(() => { member.mockReset(); vi.unstubAllEnvs(); });

describe("direct access to the live workspace", () => {
  it("does not load a chart for a visitor who has not signed in", async () => {
    member.mockRejectedValue(new Error("login redirect"));
    await expect(LiveMarketPage()).rejects.toThrow("login redirect");
    expect(member).toHaveBeenCalledWith("/workbench/market");
  });

  it("does not load a chart for a UID outside the configured pilot", async () => {
    vi.stubEnv("WORKBENCH_LIVE_MARKET_ORIGIN", "https://charts.example.net");
    vi.stubEnv("WORKBENCH_LIVE_MARKET_ENABLED", "true");
    vi.stubEnv("WORKBENCH_LIVE_MARKET_PUBLIC_ENABLED", "false");
    vi.stubEnv("WORKBENCH_LIVE_MARKET_PILOT_UIDS", "33333");
    member.mockResolvedValue({ id: "member", publicUid: 22222 });
    await expect(LiveMarketPage()).rejects.toThrow("404");
  });
});

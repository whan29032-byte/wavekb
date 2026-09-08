import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TradingLeaderboardPage from "./page";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), leaderboard: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ getOptionalActiveMember: mocks.actor }));
vi.mock("@/lib/trading/server-repository", () => ({ listTradingLeaderboard: mocks.leaderboard }));
vi.mock("@/components/exchange-connection", () => ({ ExchangeConnectionPanel: () => <section aria-label="交易所连接" /> }));

beforeEach(() => {
  mocks.actor.mockResolvedValue(null);
  mocks.leaderboard.mockResolvedValue([{
    rank_no: 1,
    user_id: "11111111-1111-4111-8111-111111111111",
    public_uid: 33333,
    display_name: "研究者",
    avatar_url: null,
    display_title: "",
    nameplate_style: "classic",
    return_rate: 0.1234,
    current_equity_usdt: "90071992547409.99",
    cumulative_profit_usdt: "-432.1",
    tracking_started_at: "2026-09-08T10:00:00.000Z",
    last_synced_at: "2026-09-08T12:00:00.000Z",
  }]);
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows one latest-snapshot leaderboard without historical period controls", async () => {
  render(await TradingLeaderboardPage());
  expect(screen.queryByRole("navigation", { name: "排行榜周期" })).toBeNull();
  expect(screen.queryByText("近 7 天")).toBeNull();
  expect(screen.queryByText(/至少跟踪 24 小时/)).toBeNull();
  expect(screen.getByText("实时收益率")).toBeTruthy();
  expect(screen.getByText("当前权益")).toBeTruthy();
  expect(screen.getByText("累计盈利")).toBeTruthy();
  expect(screen.getByText("最近同步")).toBeTruthy();
  expect(screen.getByText("+12.34%")).toBeTruthy();
  expect(screen.getByText("90,071,992,547,409.99 USDT")).toBeTruthy();
  expect(screen.getByText("-432.10 USDT")).toBeTruthy();
});

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { RewardCenter } from "./reward-center";
import story from "./reward-center.stories";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);
it("shows the actual nameplate renderer in product previews and dated ledger notes", () => {
  const { container } = render(<RewardCenter {...story.args} />);
  const product = screen.getByRole("heading", { name: "紫曜鎏金铭牌" }).closest("article")!;
  expect(product.querySelector('.identity-nameplate[data-nameplate="purplegold"]')).toBeTruthy();
  expect(container.querySelector('time[datetime="2026-08-13T08:00:00.000Z"]')).toBeTruthy();
  expect(screen.getByText("每篇内容首次奖励，签到每天一次")).toBeTruthy();
});
it("does not offer to spend points on the currently worn title again", () => {
  const initialCenter = { ...story.args.initialCenter, products: [{ ...story.args.initialCenter.products[0], product_type: "title" as const, name: "研究称号", metadata: { display_title: "波浪研究者" } }] };
  render(<RewardCenter {...story.args} initialCenter={initialCenter} profile={{ display_name: "研究者", avatar_url: null, public_uid: 12345, nameplate_style: "classic", display_title: "波浪研究者" }} />);
  const article = screen.getByRole("heading", { name: "研究称号" }).closest("article")!;
  expect((within(article).getByRole("button", { name: "当前称号" }) as HTMLButtonElement).disabled).toBe(true);
});
it("uses refreshed profile identity instead of retaining the old title", () => {
  const initialCenter = { ...story.args.initialCenter, products: [{ ...story.args.initialCenter.products[0], product_type: "title" as const, name: "研究称号", metadata: { display_title: "波浪研究者" } }] };
  const props = { ...story.args, initialCenter, profile: { display_name: "研究者", avatar_url: null, public_uid: 12345, nameplate_style: "classic", display_title: "另一称号" } };
  const { rerender } = render(<RewardCenter {...props} />);
  expect(screen.queryByRole("button", { name: "当前称号" })).toBeNull();
  rerender(<RewardCenter {...props} profile={{ ...props.profile, display_title: "波浪研究者" }} />);
  expect((screen.getByRole("button", { name: "当前称号" }) as HTMLButtonElement).disabled).toBe(true);
});
it.each(["same", "different"])("refreshes wallet and entitlement state for a %s account's server props", (account) => {
  const { rerender } = render(<RewardCenter {...story.args} />);
  const initialCenter = { ...story.args.initialCenter, wallet: { balance: 321, lifetime_earned: 500 }, nameplates: [{ ...story.args.initialCenter.nameplates[0], equipped: true, expires_at: "2099-01-01" }], ledger: [] };
  rerender(<RewardCenter {...story.args} actorId={account === "same" ? story.args.actorId : "another-owner"} initialCenter={initialCenter} />);
  expect(within(screen.getByLabelText("积分余额")).getByText("321")).toBeDefined();
  expect(screen.getByRole("button", { name: "当前佩戴" })).toBeDefined();
  expect(screen.queryByText("兑换：铂光序列铭牌")).toBeNull();
});

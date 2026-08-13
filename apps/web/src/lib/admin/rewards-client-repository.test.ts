import { describe, expect, it, vi } from "vitest";
import { adminRewardMutations } from "./rewards-client-repository";

describe("admin reward mutations", () => {
  it("updates products through the protected upsert operation", async () => {
    const upsertProduct = vi.fn(async () => "product-id");
    const actions = adminRewardMutations({} as never, { upsertProduct, adjustPoints: vi.fn(), updateRedemption: vi.fn(), grantNameplate: vi.fn(), revokeNameplate: vi.fn() });
    await actions.upsertProduct({ id: "product-id", name: "铂光铭牌", summary: "身份权益", description: "有效 30 天", category: "identity", productType: "nameplate", pricePoints: 1200, stock: -1, metadata: { nameplate_style: "platinum", duration_days: 30 }, active: false, sortOrder: 10 });
    expect(upsertProduct).toHaveBeenCalledWith(expect.objectContaining({ id: "product-id", active: false, stock: -1 }));
  });

  it("keeps wallet adjustments and revocations narrowly scoped", async () => {
    const adjustPoints = vi.fn(async () => ({ balance: 750, delta: -50 }));
    const revokeNameplate = vi.fn(async () => undefined);
    const actions = adminRewardMutations({} as never, { upsertProduct: vi.fn(), adjustPoints, updateRedemption: vi.fn(), grantNameplate: vi.fn(), revokeNameplate });
    await actions.adjustPoints("user-id", -50, "撤销重复奖励");
    await actions.revokeNameplate("entitlement-id");
    expect(adjustPoints).toHaveBeenCalledWith("user-id", -50, "撤销重复奖励");
    expect(revokeNameplate).toHaveBeenCalledWith("entitlement-id");
  });

  it("passes refund status to the idempotent server operation", async () => {
    const updateRedemption = vi.fn(async () => undefined);
    const actions = adminRewardMutations({} as never, { upsertProduct: vi.fn(), adjustPoints: vi.fn(), updateRedemption, grantNameplate: vi.fn(), revokeNameplate: vi.fn() });
    await actions.updateRedemption("redemption-id", "refunded", "服务无法交付");
    expect(updateRedemption).toHaveBeenCalledWith("redemption-id", "refunded", "服务无法交付");
  });
});

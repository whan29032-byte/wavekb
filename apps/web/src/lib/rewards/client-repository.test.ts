import { describe, expect, it, vi } from "vitest";
import { rewardMutations } from "./client-repository";

describe("reward center mutations", () => {
  it("redeems exactly one server-priced product", async () => {
    const redeem = vi.fn(async () => ({ redemption_id: "redemption-id", status: "fulfilled", balance: 800 }));
    const actions = rewardMutations({} as never, { checkIn: vi.fn(), redeem, equip: vi.fn() });
    await expect(actions.redeem("product-id")).resolves.toMatchObject({ status: "fulfilled", balance: 800 });
    expect(redeem).toHaveBeenCalledWith("product-id");
  });

  it("keeps nameplate equipment scoped to an entitlement id", async () => {
    const equip = vi.fn(async () => ({ equipped: true, style: "platinum", expires_at: "2026-09-01T00:00:00.000Z" }));
    const actions = rewardMutations({} as never, { checkIn: vi.fn(), redeem: vi.fn(), equip });
    await actions.equip("entitlement-id");
    expect(equip).toHaveBeenCalledWith("entitlement-id");
  });
});

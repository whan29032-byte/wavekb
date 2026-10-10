import { describe, expect, it } from "vitest";
import { parseMyMembershipWallet, parseWalletAdminStore, parseWalletCatalog, parseWalletOrder, parseWalletRoute, walletAmountDecimal, walletTransferHash } from "./wallet-types";
import { walletPreviewAdmin, walletPreviewMine, walletPreviewOrder, walletPreviewRoutes, walletPreviewVerification } from "@/components/membership-wallet.fixtures";

describe("wallet exact invoices and canonical assets", () => {
  it("keeps exact micro-units and unique tails without floating conversion", () => { expect(walletAmountDecimal("52001237")).toBe("52.001237"); expect(walletAmountDecimal("520000001")).toBe("520.000001"); expect(walletAmountDecimal("999999999999999999")).toBe("999999999999.999999"); });
  it.each(["0", "052000000", "5e7", "-1", "52.001237", "52000000.0"])("rejects noncanonical units %s", (value) => { expect(() => walletAmountDecimal(value)).toThrow(); });
  it("requires all four issuer-verified chain/asset contracts and no invented address", () => {
    expect(parseWalletCatalog(walletPreviewMine().catalog).purchase_available).toBe(false); expect(parseWalletAdminStore(walletPreviewAdmin()).routes.every((route) => route.recipient === null && !route.enabled)).toBe(true);
    const route = walletPreviewRoutes(true)[0]; expect(() => parseWalletRoute({ ...route, contract: "T" + "1".repeat(33) })).toThrow(); expect(() => parseWalletRoute({ ...route, id: "base-usdt" })).toThrow();
    expect(() => parseWalletRoute({ ...route, enabled: true, recipient: null })).toThrow(); expect(() => parseWalletCatalog({ ...walletPreviewMine().catalog, purchase_available: true })).toThrow();
  });
  it("parses an authoritative order's frozen address and all six decimals", () => { expect(parseWalletOrder(walletPreviewOrder()).amount_decimal).toBe("52.001237"); const mine = walletPreviewMine(); mine.orders = [walletPreviewOrder()]; expect(parseMyMembershipWallet(mine).orders).toHaveLength(1); });
  it.each([{ amount_units: "52000000", amount_decimal: "52.000000" }, { amount_units: "52010000", amount_decimal: "52.010000" }, { amount_decimal: "52.00" }, { amount_units: 52001237 }, { base_amount_units: "52000001" }, { recipient: "0x" + "0".repeat(40) }, { asset: "USDT" }, { status: "paid", paid_at: null }, { expires_at: "2099-10-10T00:31:00Z" }])("rejects unsafe frozen invoice $amount_decimal", (patch) => { expect(() => parseWalletOrder({ ...walletPreviewOrder(), ...patch })).toThrow(); });
  it("normalizes complete network-specific transaction hashes only", () => { expect(walletTransferHash("base", " 0x" + "A".repeat(64) + " ")).toBe("0x" + "a".repeat(64)); expect(walletTransferHash("tron", "A".repeat(64))).toBe("a".repeat(64)); expect(() => walletTransferHash("tron", "0x" + "a".repeat(64))).toThrow(); expect(() => walletTransferHash("base", "0x" + "1".repeat(40))).toThrow(); });
  it("only exposes bounded reconciliation data and allowlisted reason codes, stripping private evidence", () => {
    const receipt = { id: "00000000-0000-4000-8000-000000000119", order_id: walletPreviewOrder().id, verification_id: walletPreviewVerification().id, chain: "base", tx_hash: walletPreviewVerification().tx_hash, event_index: 0, outcome: "review", reason_code: "payment_amount_mismatch", created_at: "2099-10-10T00:15:00Z", evidence: { provider: "private raw response" } };
    const store = { ...walletPreviewAdmin(), orders: [walletPreviewOrder()], verifications: [{ ...walletPreviewVerification("review"), reason_code: "payment_amount_mismatch", reason: "private provider exception", worker_id: "internal" }], receipts: [receipt] };
    const result = parseWalletAdminStore(store); expect(result.receipts[0]).not.toHaveProperty("evidence"); expect(result.verifications[0]).not.toHaveProperty("reason"); expect(result.verifications[0]).not.toHaveProperty("worker_id");
    expect(() => parseWalletAdminStore({ ...store, receipts: [{ ...receipt, reason_code: "unapproved_provider_secret" }] })).toThrow();
    expect(() => parseWalletAdminStore({ ...store, receipts: [{ ...receipt, order_id: receipt.id }] })).toThrow();
  });
});

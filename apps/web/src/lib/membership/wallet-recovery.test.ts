import { beforeEach, expect, it } from "vitest";
import { clearWalletAttempt, readWalletAttempt, walletAttemptKey, writeWalletAttempt, type WalletCheckoutAttempt } from "./wallet-recovery";
import { walletExpectedQuote } from "./wallet-types";
import { walletPreviewOrder, walletPreviewRoutes } from "@/components/membership-wallet.fixtures";
import { membershipPreviewActor, membershipPreviewPlan, membershipPreviewRequest } from "@/components/membership-commerce.fixtures";
import { installBrowserStorage } from "@/test/browser-storage";

const checkout: WalletCheckoutAttempt = { kind: "checkout", ownerId: membershipPreviewActor, requestId: membershipPreviewRequest, routeId: "base-usdc", expectedQuote: walletExpectedQuote(membershipPreviewPlan, membershipPreviewPlan.prices[0], walletPreviewRoutes(true)[3]) };
beforeEach(installBrowserStorage);
it("persists the exact original owner request and quote across reloads", () => { writeWalletAttempt(checkout); expect(readWalletAttempt(membershipPreviewActor)).toEqual(checkout); expect(localStorage.getItem(walletAttemptKey(membershipPreviewActor))).not.toMatch(/secret|private_key|seed/i); });
it("never overwrites an unknown checkout with a new request or transfer", () => { writeWalletAttempt(checkout); expect(() => writeWalletAttempt({ ...checkout, requestId: walletPreviewOrder().id })).toThrow("checkpoint_changed"); expect(() => clearWalletAttempt({ ...checkout, requestId: walletPreviewOrder().id })).toThrow(); clearWalletAttempt(checkout); expect(readWalletAttempt(membershipPreviewActor)).toBeNull(); });
it("binds a persisted transfer retry to its original network, order and complete hash", () => { const transfer = { kind: "transfer" as const, ownerId: membershipPreviewActor, orderId: walletPreviewOrder().id, chain: "base" as const, txHash: "0x" + "a".repeat(64) }; writeWalletAttempt(transfer); expect(readWalletAttempt(membershipPreviewActor)).toEqual(transfer); expect(() => writeWalletAttempt({ ...transfer, txHash: "0x" + "b".repeat(64) })).toThrow(); });
it("rejects corrupted or different-account checkpoints instead of inventing success", () => { localStorage.setItem(walletAttemptKey(membershipPreviewActor), JSON.stringify({ ...checkout, ownerId: walletPreviewOrder().id })); expect(() => readWalletAttempt(membershipPreviewActor)).toThrow(); localStorage.setItem(walletAttemptKey(membershipPreviewActor), "invalid"); expect(() => readWalletAttempt(membershipPreviewActor)).toThrow(); });

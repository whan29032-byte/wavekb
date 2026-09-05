import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installBrowserStorage } from "@/test/browser-storage";
import { notifyIdentityChanged, subscribeIdentityChanges } from "./identity-events";

beforeEach(() => installBrowserStorage());
afterEach(() => vi.unstubAllGlobals());
it("invalidates local identity reads and stops after unsubscribe", () => {
  const listener = vi.fn(); const stop = subscribeIdentityChanges(listener);
  notifyIdentityChanged("owner"); expect(listener).toHaveBeenCalledWith("owner");
  stop(); notifyIdentityChanged("owner"); expect(listener).toHaveBeenCalledTimes(1);
});
it("invalidates other tabs without accepting identity or entitlement values", () => {
  const listener = vi.fn(); const stop = subscribeIdentityChanges(listener);
  window.dispatchEvent(new StorageEvent("storage", { key: "wavekb:identity:changed", newValue: JSON.stringify({ actorId: "owner", revision: "1", style: "blackgold" }) }));
  expect(listener).toHaveBeenCalledExactlyOnceWith("owner");
  window.dispatchEvent(new StorageEvent("storage", { key: "wavekb:identity:changed", newValue: "broken" }));
  expect(listener).toHaveBeenCalledTimes(1); stop();
});

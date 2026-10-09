import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PWA_BOOTSTRAP, registerPwaOnce } from "./pwa-bootstrap";

type Owner = Window & { __wavekbPwaRegistration?: Promise<ServiceWorkerRegistration | undefined> };

afterEach(() => {
  delete (window as Owner).__wavekbPwaRegistration;
  vi.restoreAllMocks();
});

function fixture(register = vi.fn().mockResolvedValue({ scope: "/" })) {
  const owner = { isSecureContext: true, __wavekbPwaRegistration: undefined as unknown };
  const navigator = { serviceWorker: { register } };
  return { owner, navigator, register, context: { window: owner, navigator } };
}

describe("parser-stage worker registration", () => {
  it("registers with the original root scope before any document or React API exists", async () => {
    const value = fixture();
    runInNewContext(PWA_BOOTSTRAP, value.context);
    expect(value.register).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/", updateViaCache: "none" });
    await expect(value.owner.__wavekbPwaRegistration).resolves.toEqual({ scope: "/" });
  });

  it("does not wait for registration and does not duplicate an in-flight attempt", () => {
    const value = fixture(vi.fn().mockReturnValue(new Promise(() => {})));
    runInNewContext(PWA_BOOTSTRAP, value.context);
    runInNewContext(PWA_BOOTSTRAP, value.context);
    expect(value.register).toHaveBeenCalledTimes(1);
  });

  it("fails open for unsupported, insecure and synchronously broken registration", () => {
    const unsupported = { window: { isSecureContext: true }, navigator: {} };
    expect(() => runInNewContext(PWA_BOOTSTRAP, unsupported)).not.toThrow();
    const value = fixture();
    value.owner.isSecureContext = false;
    runInNewContext(PWA_BOOTSTRAP, value.context);
    expect(value.register).not.toHaveBeenCalled();
    value.owner.isSecureContext = true;
    value.register.mockImplementation(() => { throw new Error("unavailable"); });
    expect(() => runInNewContext(PWA_BOOTSTRAP, value.context)).not.toThrow();
  });

  it("catches a rejection and clears the attempt so hydration may recover", async () => {
    const value = fixture(vi.fn().mockRejectedValue(new Error("blocked")));
    runInNewContext(PWA_BOOTSTRAP, value.context);
    await expect(value.owner.__wavekbPwaRegistration).resolves.toBeUndefined();
    expect(value.owner.__wavekbPwaRegistration).toBeUndefined();
  });

  it("does not register again when hydration finds the parser registration", () => {
    const value = fixture(vi.fn().mockReturnValue(new Promise(() => {})));
    runInNewContext(PWA_BOOTSTRAP, value.context);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: value.navigator.serviceWorker });
    (window as Owner).__wavekbPwaRegistration = value.owner.__wavekbPwaRegistration as Owner["__wavekbPwaRegistration"];
    registerPwaOnce();
    expect(value.register).toHaveBeenCalledTimes(1);
  });

  it("preserves a non-blocking hydration fallback when bootstrap was not executed", async () => {
    const value = fixture();
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: value.navigator.serviceWorker });
    registerPwaOnce();
    registerPwaOnce();
    expect(value.register).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/", updateViaCache: "none" });
    await (window as Owner).__wavekbPwaRegistration;
  });
});

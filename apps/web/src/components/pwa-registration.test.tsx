import { render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  delete (window as Window & { __wavekbPwaRegistration?: unknown }).__wavekbPwaRegistration;
  vi.restoreAllMocks();
});

it("starts non-blocking root-scope registration without waiting for page resources to load", async () => {
  vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  const register = vi.fn().mockResolvedValue({});
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
  const modulePath = "./pwa-registration";
  const registrationModule = await import(/* @vite-ignore */ modulePath).catch(() => null) as { PwaRegistration: React.ComponentType } | null;

  expect(registrationModule).not.toBeNull();
  if (!registrationModule) return;
  render(<registrationModule.PwaRegistration />);
  await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" }));
});

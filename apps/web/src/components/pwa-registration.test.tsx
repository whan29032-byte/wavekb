import { render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

it("registers the WaveKB service worker at the root scope after the page loads", async () => {
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
  window.dispatchEvent(new Event("load"));

  await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" }));
});

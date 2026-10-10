import { afterEach, describe, expect, it, vi } from "vitest";
import { authContinuationPath, registrationCallbackPath, replaceAuthLocation } from "./return-path";

afterEach(()=>vi.unstubAllGlobals());

describe("auth continuation paths", () => {
  it("preserves a same-site destination, including its query and fragment, through signup", () => {
    const destination = "/membership/plans?plan=vip&period=year#join";
    expect(new URL(authContinuationPath("/register", destination), "https://wavekb.invalid").searchParams.get("next")).toBe(destination);
    const callback = new URL(registrationCallbackPath(destination), "https://wavekb.invalid");
    expect(callback.pathname).toBe("/register");expect(callback.searchParams.get("auth")).toBe("signup");expect(callback.searchParams.get("next")).toBe(destination);
    expect(new URL(authContinuationPath("/activate-uid", callback.searchParams.get("next")), "https://wavekb.invalid").searchParams.get("next")).toBe(destination);
  });
  it.each(["https://attacker.example", "//attacker.example", "/\\attacker.example", "/\n/attacker.example", "javascript:alert(1)"])("never promotes %s into an external auth return", (destination) => {
    for (const path of [authContinuationPath("/register", destination), registrationCallbackPath(destination), authContinuationPath("/activate-uid", destination)]) {
      const url = new URL(path, "https://wavekb.invalid");
      expect(url.origin).toBe("https://wavekb.invalid");expect(url.searchParams.get("next")).toBe("/community/idea_sharing");
    }
  });
  it("preserves the existing no-return registration and UID activation defaults", () => {
    expect(authContinuationPath("/register")).toBe("/register");expect(authContinuationPath("/activate-uid")).toBe("/activate-uid");expect(registrationCallbackPath()).toBe("/register?auth=signup");
  });
  it("rechecks the destination at the full-page navigation boundary", () => {
    const replace=vi.fn();vi.stubGlobal("window",{location:{replace}});
    replaceAuthLocation("https://attacker.example");expect(replace).toHaveBeenLastCalledWith("/community/idea_sharing");
    replaceAuthLocation("/membership/plans?period=year#join");expect(replace).toHaveBeenLastCalledWith("/membership/plans?period=year#join");
  });
});

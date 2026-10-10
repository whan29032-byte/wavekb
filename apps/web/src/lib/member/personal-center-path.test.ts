import { expect, it } from "vitest";
import { personalCenterPath } from "./personal-center-path";

it("returns only the current actor's verified public profile", () => {
  expect(personalCenterPath("owner", { id: "owner", public_uid: 12345 })).toBe("/member/12345");
  expect(personalCenterPath("owner", { id: "other", public_uid: 12345 })).toBe("/member/profile");
});

it.each([null, 0, 1234, 1000000, 12345.5, Number.NaN])("falls back to the private profile route when the UID is unavailable or invalid (%s)", (public_uid) => {
  expect(personalCenterPath("owner", { id: "owner", public_uid })).toBe("/member/profile");
  expect(personalCenterPath("owner", null)).toBe("/member/profile");
});

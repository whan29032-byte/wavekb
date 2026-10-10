import { expect, it } from "vitest";
import { isDefiniteDatabaseRejection, isUncertainMutationError, sameJsonValue, UncertainMutationError } from "./mutation-recovery";

it.each(["P0001", "23505", "42501", "40001", "40P01"])("recognizes explicit statement rejection %s", (code) => {
  expect(isDefiniteDatabaseRejection({ code })).toBe(true);
});
it.each(["40003", "08007", "57014", "PGRST000", "500", undefined])("never treats uncertain/transport status %s as rollback", (code) => {
  expect(isDefiniteDatabaseRejection({ code })).toBe(false);
});
it("compares JSONB values independently of object-key ordering but keeps array order", () => {
  expect(sameJsonValue({ b: [{ x: 1, y: 2 }], a: "value" }, { a: "value", b: [{ y: 2, x: 1 }] })).toBe(true);
  expect(sameJsonValue([1, 2], [2, 1])).toBe(false);
});
it("distinguishes a recoverable unknown result from an ordinary rejected mutation", () => {
  expect(isUncertainMutationError(new UncertainMutationError("preserved"))).toBe(true);
  expect(isUncertainMutationError(new Error("rejected"))).toBe(false);
});

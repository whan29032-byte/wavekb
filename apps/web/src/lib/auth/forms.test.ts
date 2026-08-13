import { describe, expect, it } from "vitest";
import {
  friendlyAuthError,
  safeReturnPath,
  validatePasswordUpdate,
  validateRegistrationCompletion,
  validateRegistrationIdentity,
} from "./forms";

describe("auth form helpers", () => {
  it("only accepts same-site return paths", () => {
    expect(safeReturnPath("/friends")).toBe("/friends");
    expect(safeReturnPath("//attacker.example/path")).toBe("/community/idea_sharing");
    expect(safeReturnPath("/\\attacker.example/path")).toBe("/community/idea_sharing");
    expect(safeReturnPath("/friends?tab=pending#requests")).toBe("/friends?tab=pending#requests");
    expect(safeReturnPath("https://attacker.example")).toBe("/community/idea_sharing");
  });

  it("validates registration identity and completion fields", () => {
    expect(validateRegistrationIdentity({ displayName: "A", email: "bad" })).toEqual({
      displayName: "昵称需要 2 到 32 个字符。",
      email: "请输入有效邮箱。",
    });
    expect(validateRegistrationCompletion({
      displayName: "测试用户",
      email: "member@example.com",
      verificationCode: "123456",
      password: "long-enough-password",
      confirmPassword: "long-enough-password",
    })).toEqual({});
  });

  it("validates password confirmation and maps service errors", () => {
    expect(validatePasswordUpdate("short", "different")).toEqual({
      password: "密码至少需要 10 个字符。",
      confirmPassword: "两次输入的密码不一致。",
    });
    expect(friendlyAuthError(new Error("uid_refresh_exhausted"))).toContain("刷新次数");
  });
});

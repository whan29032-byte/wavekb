import { describe, expect, it } from "vitest";
import { membershipError, parseGrantReceipt, parseMembershipAdminStore, parseMyMembership, parsePlanReceipt } from "./types";

const grant = {
  id: "40000000-0000-4000-8000-000000000001", plan_key: "vip", status: "active",
  starts_at: "2026-10-10T00:00:00Z", ends_at: "2026-12-01T00:00:00Z", revision: 1,
};
const history = {
  id: "50000000-0000-4000-8000-000000000001", action: "granted",
  title: "VIP 会员", created_at: "2026-10-10T00:00:00Z", ends_at: grant.ends_at,
};
const plan = {
  key: "vip", title: "VIP 会员", description: "未开放购买",
  benefits: { member_badge: "会员标识" }, enabled: false, revision: 1,
};
const memberGrant = { ...grant, title: plan.title, benefits: plan.benefits };
const mine = { billing_enabled: false, grants: [memberGrant], history: [history] };
const member = { id: "20000000-0000-4000-8000-000000000001", public_uid: 10001, display_name: "会员", account_status: "active" };
const store = { plans: [plan], member, grants: [grant], history: [history] };

describe("membership response parsers", () => {
  it.each(["active", "revoked", "disabled", "scheduled", "expired"])("accepts the member lifecycle state %s", (status) => {
    const value = { ...mine, grants: [{ ...memberGrant, status, benefits: status === "active" ? plan.benefits : {} }] };
    expect(parseMyMembership(value)).toEqual(value);
  });

  it("accepts empty states with billing explicitly disabled", () => {
    expect(parseMyMembership({ billing_enabled: false, grants: [], history: [] })).toEqual({ billing_enabled: false, grants: [], history: [] });
    expect(parseMembershipAdminStore({ plans: [], member: null, grants: [], history: [] })).toEqual({ plans: [], member: null, grants: [], history: [] });
  });

  it("accepts admin records and revoked grants without adding implicit purchases", () => {
    const value = {
      ...store, grants: [{ ...grant, status: "revoked" }], member: { ...member, account_status: "banned" },
      history: [history, { id: history.id, action: "plan_updated", created_at: history.created_at, plan_key: "vip", reason: "确认方案内容", after_state: plan }],
    };
    expect(parseMembershipAdminStore(value)).toEqual(value);
    expect(parseMembershipAdminStore(store).plans[0].enabled).toBe(false);
  });

  it.each([null, undefined, [], "ok", {}, { ...mine, billing_enabled: true }, { ...mine, billing_enabled: undefined }, { ...mine, grants: null }, { ...mine, history: {} }])("rejects missing/malformed member service payloads (%#)", (value) => {
    expect(() => parseMyMembership(value)).toThrow("membership_response_invalid");
  });

  it.each([
    { ...memberGrant, id: "" }, { ...memberGrant, plan_key: "" }, { ...memberGrant, title: null },
    { ...memberGrant, status: "paid" }, { ...memberGrant, status: ["active"] },
    { ...memberGrant, benefits: [] }, { ...memberGrant, benefits: { member_badge: true } },
    { ...memberGrant, starts_at: null }, { ...memberGrant, starts_at: "invalid date" },
    { ...memberGrant, ends_at: "infinity" }, { ...memberGrant, ends_at: grant.starts_at },
    { ...memberGrant, revision: NaN }, { ...memberGrant, revision: Infinity },
    { ...memberGrant, revision: 0 }, { ...memberGrant, revision: -1 }, { ...memberGrant, revision: 1.5 },
  ])("rejects a malformed member grant (%#)", (value) => {
    expect(() => parseMyMembership({ ...mine, grants: [value] })).toThrow("membership_response_invalid");
  });

  it.each([null, undefined, [], {}, { ...store, plans: null }, { ...store, grants: {} }, { ...store, history: null }, { ...store, member: undefined }])("rejects missing/malformed admin service payloads (%#)", (value) => {
    expect(() => parseMembershipAdminStore(value)).toThrow("membership_response_invalid");
  });

  it.each([
    { ...plan, key: "" }, { ...plan, title: null }, { ...plan, description: null },
    { ...plan, enabled: "false" }, { ...plan, benefits: { member_badge: 1 } },
    { ...plan, revision: NaN }, { ...plan, revision: Infinity },
    { ...plan, revision: 0 }, { ...plan, revision: 1.5 },
  ])("rejects malformed admin plan records (%#)", (value) => {
    expect(() => parseMembershipAdminStore({ ...store, plans: [value] })).toThrow("membership_response_invalid");
  });

  it.each([
    { ...grant, status: "expired" }, { ...grant, id: null }, { ...grant, starts_at: "bad" },
    { ...grant, revision: NaN }, { ...grant, ends_at: grant.starts_at },
  ])("rejects malformed admin grants (%#)", (value) => {
    expect(() => parseMembershipAdminStore({ ...store, grants: [value] })).toThrow("membership_response_invalid");
  });

  it.each([
    { ...member, id: null }, { ...member, public_uid: null },
    { ...member, public_uid: NaN }, { ...member, public_uid: Infinity }, { ...member, public_uid: 1.5 },
    { ...member, display_name: null }, { ...member, account_status: null }, { ...member, account_status: ["active"] },
  ])("rejects malformed queried member records (%#)", (value) => {
    expect(() => parseMembershipAdminStore({ ...store, member: value })).toThrow("membership_response_invalid");
  });

  it.each([
    null, { ...history, id: null }, { ...history, action: null }, { ...history, action: ["granted"] }, { ...history, created_at: "bad" },
    { ...history, ends_at: "bad" }, { ...history, title: 1 },
    { ...history, reason: {} }, { ...history, plan_key: [] },
  ])("rejects malformed history in both member and admin stores (%#)", (value) => {
    expect(() => parseMyMembership({ ...mine, history: [value] })).toThrow("membership_response_invalid");
    expect(() => parseMembershipAdminStore({ ...store, history: [value] })).toThrow("membership_response_invalid");
  });

  it("accepts SQL history with an absent optional expiry or explicit null", () => {
    const value = { id: history.id, action: "revoked", created_at: history.created_at };
    expect(parseMembershipAdminStore({ ...store, history: [value] }).history).toEqual([value]);
    expect(parseMyMembership({ ...mine, history: [{ ...value, ends_at: null }] }).history).toEqual([{ ...value, ends_at: null }]);
  });
});

describe("standalone mutation receipt parsers", () => {
  it("accepts full plan and grant receipts, including revoked grant receipts", () => {
    expect(parsePlanReceipt(plan)).toEqual(plan);
    const value = { ...grant, user_id: member.id };
    expect(parseGrantReceipt(value)).toEqual(value);
    expect(parseGrantReceipt({ ...value, status: "revoked" }).status).toBe("revoked");
  });

  it.each([null, {}, { ...grant, user_id: null }, { ...grant, user_id: "not-a-uuid" }, { ...grant, user_id: member.id, status: ["active"] }])("rejects an incomplete/malformed grant receipt (%#)", (value) => {
    expect(() => parseGrantReceipt(value)).toThrow("membership_response_invalid");
  });

  it.each([null, {}, { key: "vip", revision: 2 }])("rejects a partial plan receipt (%#)", (value) => {
    expect(() => parsePlanReceipt(value)).toThrow("membership_response_invalid");
  });
});

describe("membership error messages", () => {
  it.each([
    [new Error("membership_changed_concurrently"), "记录已改变"],
    [{ message: "membership_already_active" }, "记录已改变"],
    [new Error("membership_plan_disabled"), "方案尚未启用"],
    [new Error("membership_extension_invalid"), "五年"],
    [{ message: "membership_dates_invalid" }, "五年"],
    [{ message: "member_not_found" }, "站内 UID"],
    [{ message: "admin_required" }, "当前账户无权操作"],
    [{ message: "account_ineligible" }, "当前账户无权操作"],
    [new Error("authentication_required"), "重新登录"],
    [{ message: "request_conflict" }, "配置或操作参数无效"],
    [{ message: "membership_benefits_invalid" }, "配置或操作参数无效"],
    [{ code: "PGRST202", message: "Could not find the function in the schema cache" }, "会员服务尚未部署"],
    [new Error("function public.get_my_membership() does not exist"), "会员服务尚未部署"],
    [new Error("membership_response_invalid"), "不要直接重复授予或撤销"],
    [null, "不要直接重复授予或撤销"],
  ])("provides a safe explanation without retrying writes (%#)", (error, message) => {
    expect(membershipError(error)).toContain(message);
  });
});

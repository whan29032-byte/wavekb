import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { membershipRepository } from "./client-repository";

const actorId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const planInput = {
  key: "vip", title: "VIP 会员", description: "人工授权方案",
  benefits: { member_badge: "会员标识" }, enabled: true,
  revision: 1, reason: "确认方案内容", requestId,
};
const changeInput = {
  userId, planKey: "vip", action: "grant" as const,
  endsAt: "2026-12-01T00:00:00.000Z", revision: 0, reason: "人工授予会员", requestId,
};
const planReceipt = { ...planInput, revision: 2 };
const grantReceipt = {
  id: "40000000-0000-4000-8000-000000000001", user_id: userId,
  plan_key: "vip", status: "active", starts_at: "2026-10-10T00:00:00.000Z",
  ends_at: changeInput.endsAt, revision: 1,
};
const mineReceipt = { billing_enabled: false, grants: [], history: [] };
const storeReceipt = { plans: [], member: null, grants: [], history: [] };

function setup(data: unknown, error: unknown = null) {
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const from = vi.fn();
  const client = { auth: { getUser }, rpc, from } as unknown as SupabaseClient;
  return { repository: membershipRepository(client, actorId), getUser, rpc, from };
}

type Operation = "mine" | "adminStore" | "savePlan" | "change";
function invoke(repository: ReturnType<typeof membershipRepository>, operation: Operation) {
  if (operation === "mine") return repository.mine();
  if (operation === "adminStore") return repository.adminStore(10001);
  if (operation === "savePlan") return repository.savePlan(planInput);
  return repository.change(changeInput);
}

describe("membership repository authentication boundary", () => {
  it.each<Operation>(["mine", "adminStore", "savePlan", "change"])("refuses %s before RPC when the account changed", async (operation) => {
    const { repository, getUser, rpc } = setup(null);
    getUser.mockResolvedValueOnce({ data: { user: { id: userId } }, error: null });
    await expect(invoke(repository, operation)).rejects.toThrow("authentication_required");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: actorId } }, error: { message: "expired session" } },
  ])("refuses missing or invalid authentication before RPC", async (auth) => {
    const { repository, getUser, rpc } = setup(planReceipt);
    getUser.mockResolvedValueOnce(auth);
    await expect(repository.savePlan(planInput)).rejects.toThrow("authentication_required");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each<Operation>(["mine", "adminStore", "savePlan", "change"])("rejects a successful %s response after the account changed", async (operation) => {
    const { repository, getUser, rpc } = setup(null);
    getUser
      .mockResolvedValueOnce({ data: { user: { id: actorId } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: userId } }, error: null });
    await expect(invoke(repository, operation)).rejects.toThrow("authentication_required");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: actorId } }, error: { message: "session expired in flight" } },
  ])("rejects a mutation response when post-request authentication is invalid", async (auth) => {
    const { repository, getUser } = setup(grantReceipt);
    getUser
      .mockResolvedValueOnce({ data: { user: { id: actorId } }, error: null })
      .mockResolvedValueOnce(auth);
    await expect(repository.change(changeInput)).rejects.toThrow("authentication_required");
  });
});

describe("membership repository RPC contract", () => {
  it("binds admin queries to their actor and UID, and uses no direct table access", async () => {
    const { repository, rpc, from } = setup(storeReceipt);
    await expect(repository.adminStore(10001)).resolves.toEqual(storeReceipt);
    expect(rpc).toHaveBeenCalledWith("admin_membership_store", { p_public_uid: 10001, p_actor_id: actorId });
    await repository.adminStore();
    expect(rpc).toHaveBeenLastCalledWith("admin_membership_store", { p_public_uid: null, p_actor_id: actorId });
    expect(from).not.toHaveBeenCalled();
  });

  it("binds plan updates to the actor, expected revision and caller's stable request ID", async () => {
    const { repository, rpc } = setup(planReceipt);
    await expect(repository.savePlan(planInput)).resolves.toEqual(planReceipt);
    expect(rpc).toHaveBeenCalledWith("admin_save_membership_plan", {
      p_key: "vip", p_title: planInput.title, p_description: planInput.description,
      p_benefits: planInput.benefits, p_enabled: true, p_expected_revision: 1,
      p_reason: planInput.reason, p_request_id: requestId, p_actor_id: actorId,
    });
  });

  it("accepts a plan title normalized by the database without treating it as a mismatch", async () => {
    const { repository } = setup(planReceipt);
    await expect(repository.savePlan({ ...planInput, title: `  ${planInput.title}  ` })).resolves.toEqual(planReceipt);
  });

  it("binds grants to both target and actor, with the exact requested expiry", async () => {
    const { repository, rpc } = setup(grantReceipt);
    await expect(repository.change(changeInput)).resolves.toEqual(grantReceipt);
    expect(rpc).toHaveBeenCalledWith("admin_change_membership", {
      p_user_id: userId, p_plan_key: "vip", p_action: "grant", p_ends_at: changeInput.endsAt,
      p_expected_revision: 0, p_reason: changeInput.reason, p_request_id: requestId, p_actor_id: actorId,
    });
  });

  it("keeps a retry's request ID and full payload unchanged after a lost response", async () => {
    const error = { message: "network response lost" };
    const { repository, rpc } = setup(grantReceipt);
    rpc.mockResolvedValueOnce({ data: null, error });
    await expect(repository.change(changeInput)).rejects.toEqual(error);
    await expect(repository.change(changeInput)).resolves.toEqual(grantReceipt);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[1][1].p_request_id).toBe(requestId);
  });

  it("accepts correct extension and revoke receipts without inventing billing calls", async () => {
    const extended = { ...grantReceipt, revision: 2, ends_at: "2027-01-01T00:00:00Z" };
    const { repository, rpc, from } = setup(extended);
    await expect(repository.change({ ...changeInput, action: "extend", revision: 1, endsAt: extended.ends_at })).resolves.toEqual(extended);
    const revoked = { ...extended, status: "revoked", revision: 3 };
    rpc.mockResolvedValueOnce({ data: revoked, error: null });
    await expect(repository.change({ ...changeInput, action: "revoke", revision: 2, endsAt: null })).resolves.toEqual(revoked);
    expect(rpc).toHaveBeenLastCalledWith("admin_change_membership", expect.objectContaining({ p_action: "revoke", p_ends_at: null, p_actor_id: actorId }));
    expect(from).not.toHaveBeenCalled();
  });

  it("accepts equivalent server timestamps with a different timezone representation", async () => {
    const receipt = { ...grantReceipt, ends_at: "2026-12-01T08:00:00+08:00" };
    const { repository } = setup(receipt);
    await expect(repository.change(changeInput)).resolves.toEqual(receipt);
  });

  it("reads member state through the current account RPC and revalidates the session", async () => {
    const { repository, rpc, getUser } = setup(mineReceipt);
    await expect(repository.mine()).resolves.toEqual(mineReceipt);
    expect(rpc).toHaveBeenCalledWith("get_my_membership", undefined);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it.each<Operation>(["mine", "adminStore", "savePlan", "change"])("fails closed for %s when the schema RPC is unavailable", async (operation) => {
    const error = { code: "PGRST202", message: "Could not find the function in the schema cache" };
    const { repository, rpc } = setup(null, error);
    await expect(invoke(repository, operation)).rejects.toEqual(error);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("preserves a database optimistic-lock rejection even if data is present", async () => {
    const error = { message: "membership_changed_concurrently" };
    const { repository } = setup(grantReceipt, error);
    await expect(repository.change(changeInput)).rejects.toEqual(error);
  });

  it.each<"mine" | "adminStore">(["mine", "adminStore"])("rejects a null %s RPC response instead of providing an empty success state", async (operation) => {
    const { repository } = setup(null);
    await expect(invoke(repository, operation)).rejects.toThrow("membership_response_invalid");
  });
});

describe("membership mutation receipts", () => {
  it.each([
    null, undefined, [], "ok", {}, { key: "vip", revision: 2 },
    { ...planReceipt, key: "other" }, { ...planReceipt, revision: 1 },
    { ...planReceipt, enabled: false }, { ...planReceipt, benefits: { other: "无关权益" } },
    { ...planReceipt, benefits: { ...planReceipt.benefits, other: "额外权益" } },
    { ...planReceipt, title: "另一方案" }, { ...planReceipt, description: "错误说明" },
  ])("does not confirm an invalid or mismatched plan receipt (%#)", async (receipt) => {
    const { repository } = setup(receipt);
    await expect(repository.savePlan(planInput)).rejects.toThrow("membership_response_invalid");
  });

  it.each([
    null, undefined, [], "ok", {}, { ...grantReceipt, id: "" },
    { ...grantReceipt, user_id: actorId }, { ...grantReceipt, plan_key: "other" },
    { ...grantReceipt, revision: 0 }, { ...grantReceipt, status: "revoked" },
    { ...grantReceipt, starts_at: "invalid date" }, { ...grantReceipt, starts_at: grantReceipt.ends_at },
    { ...grantReceipt, ends_at: "2026-11-01T00:00:00Z" },
    { ...grantReceipt, ends_at: "invalid date" },
  ])("does not confirm an invalid or mismatched grant receipt (%#)", async (receipt) => {
    const { repository } = setup(receipt);
    await expect(repository.change(changeInput)).rejects.toThrow("membership_response_invalid");
  });

  it("does not confirm revocation from a receipt still marked active", async () => {
    const { repository } = setup({ ...grantReceipt, revision: 2 });
    await expect(repository.change({ ...changeInput, action: "revoke", revision: 1, endsAt: null })).rejects.toThrow("membership_response_invalid");
  });

  it("does not confirm revocation from a partial receipt lacking grant dates", async () => {
    const { repository } = setup({ id: grantReceipt.id, user_id: userId, plan_key: "vip", status: "revoked", revision: 2 });
    await expect(repository.change({ ...changeInput, action: "revoke", revision: 1, endsAt: null })).rejects.toThrow("membership_response_invalid");
  });
});

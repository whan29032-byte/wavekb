export type MembershipPlan = { key: string; title: string; description: string; benefits: Record<string, string>; enabled: boolean; revision: number };
export type MembershipGrant = { id: string; plan_key: string; status: "active" | "revoked"; starts_at: string; ends_at: string; revision: number };
export type MemberGrant = Omit<MembershipGrant, "status"> & { title: string; status: "active" | "revoked" | "disabled" | "scheduled" | "expired"; benefits: Record<string, string> };
export type MembershipHistory = { id: string; action: string; created_at: string; title?: string; ends_at?: string | null; reason?: string; plan_key?: string };
export type MyMembership = { billing_enabled: false; grants: MemberGrant[]; history: MembershipHistory[] };
export type MembershipAdminStore = { plans: MembershipPlan[]; member: { id: string; public_uid: number; display_name: string; account_status: string } | null; grants: MembershipGrant[]; history: MembershipHistory[] };

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is Record<string, string> => record(value) && Object.entries(value).length<=20 && Object.entries(value).every(([key,item]) => /^[a-z][a-z0-9_]{1,59}$/.test(key) && typeof item === "string" && item.trim().length>0 && item.length<=240);
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const positiveInteger = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value>0;
const planKey = (value: unknown) => typeof value === "string" && /^[a-z][a-z0-9_]{1,39}$/.test(value);
const grant = (value: unknown): value is MembershipGrant => record(value) && uuid(value.id) && planKey(value.plan_key) && positiveInteger(value.revision) && date(value.starts_at) && date(value.ends_at) && Date.parse(String(value.ends_at))>Date.parse(String(value.starts_at));
const history = (value: unknown): value is MembershipHistory => record(value) && uuid(value.id) && typeof value.action==="string" && ["granted","extended","revoked","plan_updated"].includes(value.action) && date(value.created_at)
  && (value.title===undefined || typeof value.title==="string") && (value.reason===undefined || typeof value.reason==="string")
  && (value.plan_key===undefined || planKey(value.plan_key)) && (value.ends_at===undefined || value.ends_at===null || date(value.ends_at));

export function parseMyMembership(value: unknown): MyMembership {
  if (!record(value) || value.billing_enabled !== false || !Array.isArray(value.grants) || !Array.isArray(value.history)
    || !value.grants.every((item) => record(item) && typeof item.title === "string" && strings(item.benefits) && typeof item.status==="string" && ["active", "revoked", "disabled", "scheduled", "expired"].includes(item.status) && grant(item))
    || !value.history.every(history)) throw new Error("membership_response_invalid");
  return value as MyMembership;
}

export function parseMembershipAdminStore(value: unknown): MembershipAdminStore {
  if (!record(value) || !Array.isArray(value.plans) || !Array.isArray(value.grants) || !Array.isArray(value.history)
    || !value.plans.every((item) => record(item) && planKey(item.key) && typeof item.title === "string" && item.title.trim().length>=2 && item.title.length<=60 && typeof item.description === "string" && item.description.length<=1000 && strings(item.benefits) && typeof item.enabled === "boolean" && positiveInteger(item.revision))
    || !value.grants.every((item) => grant(item) && ["active", "revoked"].includes(item.status)) || !value.history.every(history)
    || !(value.member === null || (record(value.member) && uuid(value.member.id) && typeof value.member.display_name === "string" && positiveInteger(value.member.public_uid) && typeof value.member.account_status==="string" && ["active","banned"].includes(value.member.account_status)))) throw new Error("membership_response_invalid");
  return value as MembershipAdminStore;
}

export function parsePlanReceipt(value: unknown): MembershipPlan {
  return parseMembershipAdminStore({ plans:[value], grants:[], history:[], member:null }).plans[0];
}
export function parseGrantReceipt(value: unknown): MembershipGrant & { user_id:string } {
  if (!record(value) || !uuid(value.user_id) || typeof value.status!=="string" || !["active","revoked"].includes(value.status) || !grant(value)) throw new Error("membership_response_invalid");
  return value as MembershipGrant & { user_id:string };
}

export function membershipError(error: unknown) {
  const message = error instanceof Error ? error.message : record(error) ? String(error.message || "") : String(error);
  if (/membership_changed_concurrently|membership_already_active/.test(message)) return "记录已改变，请重新查询后再操作。";
  if (/membership_plan_disabled/.test(message)) return "方案尚未启用，请先确认方案内容。";
  if (/membership_extension_invalid|membership_dates_invalid/.test(message)) return "有效期应晚于当前时间；延长会员时必须晚于原到期时间，且不能超过五年。";
  if (/member_not_found/.test(message)) return "没有找到这个站内 UID，请核对后查询。";
  if (/admin_required|account_ineligible|authentication_required/.test(message)) return "当前账户无权操作，请重新登录并确认账户状态。";
  if (/membership_benefits_invalid|membership_input_invalid|request_conflict/.test(message)) return "配置或操作参数无效，请检查权益格式、原因与有效期后重试。";
  if (/PGRST202|schema cache|does not exist/.test(message)) return "会员服务尚未部署，暂时不可使用。";
  return "未获得有效回执。请先重新查询核对结果，不要直接重复授予或撤销。";
}

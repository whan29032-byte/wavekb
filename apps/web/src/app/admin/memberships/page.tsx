import type { Metadata } from "next";
import { Certificate } from "@phosphor-icons/react/dist/ssr";
import { AdminMemberships } from "@/components/admin-memberships";
import { requireAdminActor } from "@/lib/admin/auth";
import { membershipError, parseMembershipAdminStore, type MembershipAdminStore } from "@/lib/membership/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "会员管理" };
export default async function AdminMembershipsPage() {
  const actor = await requireAdminActor("/admin/memberships");
  if (!actor) return null;
  let store: MembershipAdminStore | null = null; let error="";
  try { const result=await (await createClient()).rpc("admin_membership_store", { p_actor_id: actor.id }); if (result.error) throw result.error; store=parseMembershipAdminStore(result.data); }
  catch (failure) { error=membershipError(failure); }
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Certificate aria-hidden size={18} />独立会员权限</span><h1 className="text-3xl font-semibold tracking-tight">会员管理</h1><p className="max-w-[74ch] text-sm leading-6 text-muted-foreground">按站内 UID 核对、授予、延长或撤销会员，所有变更保留原因、操作者与前后状态。</p></header><AdminMemberships key={actor.id} actorId={actor.id} initial={store} initialError={error} /></main>;
}

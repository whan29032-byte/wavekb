import type { Metadata } from "next";
import { Certificate } from "@phosphor-icons/react/dist/ssr";
import { MembershipCenter } from "@/components/membership-center";
import { requireActiveMember } from "@/lib/auth/dal";
import { membershipError, parseMyMembership, type MyMembership } from "@/lib/membership/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "会员中心", robots: { index: false, follow: false } };
export default async function MembershipPage() {
  const actor = await requireActiveMember("/membership");
  let initial: MyMembership | null = null; let error = "";
  try {
    const result = await (await createClient()).rpc("get_my_membership");
    if (result.error) throw result.error;
    initial = parseMyMembership(result.data);
  } catch (failure) { error = membershipError(failure); }
  return <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-6 md:py-12"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-medium text-primary"><Certificate aria-hidden size={18} />我的账户</span><h1 className="text-3xl font-semibold tracking-tight">会员中心</h1><p className="text-muted-foreground">查看真实会员状态、有效期和变更记录。</p></header><MembershipCenter key={actor.id} actorId={actor.id} initial={initial} initialError={error} /></main>;
}

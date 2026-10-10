import type { Metadata } from "next";
import { Certificate } from "@phosphor-icons/react/dist/ssr";
import { MembershipCenter } from "@/components/membership-center";
import { MembershipCommerce } from "@/components/membership-commerce";
import { requireActiveMember } from "@/lib/auth/dal";
import { membershipError, parseMyMembership } from "@/lib/membership/types";
import { createClient } from "@/lib/supabase/server";
import { membershipCommerceError, parseMyMembershipCommerce } from "@/lib/membership/commerce-types";

export const metadata: Metadata = { title: "会员中心", robots: { index: false, follow: false } };
export default async function MembershipPage() {
  const actor = await requireActiveMember("/membership");
  const [manual, commerce] = await Promise.all([
    (async () => { try { const result = await (await createClient()).rpc("get_my_membership"); if (result.error) throw result.error; return { value: parseMyMembership(result.data), error: "" }; } catch (failure) { return { value: null, error: membershipError(failure) }; } })(),
    (async () => { try { const result = await (await createClient()).rpc("get_my_membership_commerce", { p_actor_id: actor.id }); if (result.error) throw result.error; const value = parseMyMembershipCommerce(result.data); if (value.effective.user_id !== actor.id) throw new Error("membership_commerce_response_invalid"); return { value, error: "" }; } catch (failure) { return { value: null, error: membershipCommerceError(failure) }; } })(),
  ]);
  return <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-6 md:py-12"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-medium text-primary"><Certificate aria-hidden size={18} />我的账户</span><h1 className="text-3xl font-semibold tracking-tight">会员中心</h1><p className="text-muted-foreground">查看真实权益、一次性购买订单、管理员授权与免费账户服务。</p></header><MembershipCommerce key={`commerce:${actor.id}`} actorId={actor.id} initial={commerce.value} initialError={commerce.error} /><MembershipCenter key={actor.id} actorId={actor.id} initial={manual.value} initialError={manual.error} /></main>;
}

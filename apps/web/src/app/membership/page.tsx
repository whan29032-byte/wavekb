import type { Metadata } from "next";
import Link from "next/link";
import { Certificate } from "@phosphor-icons/react/dist/ssr";
import { MembershipCenter } from "@/components/membership-center";
import { MembershipCommerce } from "@/components/membership-commerce";
import { requireActiveMember } from "@/lib/auth/dal";
import { membershipError, parseMyMembership } from "@/lib/membership/types";
import { createClient } from "@/lib/supabase/server";
import { membershipCommerceError, parseMyMembershipCommerce } from "@/lib/membership/commerce-types";
import { getMyProfile } from "@/lib/member/server-repository";
import { personalCenterPath } from "@/lib/member/personal-center-path";

export const metadata: Metadata = { title: "我的 VIP 会员", robots: { index: false, follow: false } };
export default async function MembershipPage() {
  const actor = await requireActiveMember("/membership");
  const [manual, commerce, profile] = await Promise.all([
    (async () => { try { const result = await (await createClient()).rpc("get_my_membership"); if (result.error) throw result.error; return { value: parseMyMembership(result.data), error: "" }; } catch (failure) { return { value: null, error: membershipError(failure) }; } })(),
    (async () => { try { const result = await (await createClient()).rpc("get_my_membership_commerce", { p_actor_id: actor.id }); if (result.error) throw result.error; const value = parseMyMembershipCommerce(result.data); if (value.effective.user_id !== actor.id) throw new Error("membership_commerce_response_invalid"); return { value, error: "" }; } catch (failure) { return { value: null, error: membershipCommerceError(failure) }; } })(),
    getMyProfile(actor.id).catch(() => null),
  ]);
  return <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-6 md:py-12"><header className="grid gap-2"><Link href={personalCenterPath(actor.id, profile)} className="inline-flex min-h-11 w-fit items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">返回个人中心</Link><span className="flex items-center gap-2 text-sm font-medium text-primary"><Certificate aria-hidden size={18} />个人中心 · VIP 会员</span><h1 className="text-3xl font-semibold tracking-tight">我的 VIP 会员</h1><p className="text-muted-foreground">查看真实权益、按需开通会员并核对订单。沿用现有账号，不自动续费。</p></header><MembershipCommerce key={`commerce:${actor.id}`} actorId={actor.id} initial={commerce.value} initialError={commerce.error} /><MembershipCenter key={actor.id} actorId={actor.id} initial={manual.value} initialError={manual.error} /></main>;
}

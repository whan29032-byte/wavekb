import type { Metadata } from "next";
import { Certificate } from "@phosphor-icons/react/dist/ssr";
import { AdminMemberships } from "@/components/admin-memberships";
import { AdminMembershipCommerce } from "@/components/admin-membership-commerce";
import { AdminMembershipWallet } from "@/components/admin-membership-wallet";
import { membershipWalletError, parseWalletAdminStore } from "@/lib/membership/wallet-types";
import { requireAdminActor } from "@/lib/admin/auth";
import { membershipError, parseMembershipAdminStore } from "@/lib/membership/types";
import { createClient } from "@/lib/supabase/server";
import { membershipCommerceError, parseMembershipCommerceAdminStore } from "@/lib/membership/commerce-types";

export const metadata: Metadata = { title: "会员管理" };
export default async function AdminMembershipsPage() {
  const actor = await requireAdminActor("/admin/memberships");
  if (!actor) return null;
  const [manual, commerce, wallet] = await Promise.all([
    (async () => { try { const result=await (await createClient()).rpc("admin_membership_store", { p_actor_id: actor.id }); if (result.error) throw result.error; return { value: parseMembershipAdminStore(result.data), error: "" }; } catch (failure) { return { value: null, error: membershipError(failure) }; } })(),
    (async () => { try { const result=await (await createClient()).rpc("admin_membership_commerce_store", { p_actor_id: actor.id }); if (result.error) throw result.error; return { value: parseMembershipCommerceAdminStore(result.data), error: "" }; } catch (failure) { return { value: null, error: membershipCommerceError(failure) }; } })(),
    (async () => { try { const result=await (await createClient()).rpc("admin_membership_wallet_store", { p_actor_id: actor.id }); if (result.error) throw result.error; return { value: parseWalletAdminStore(result.data), error: "" }; } catch (failure) { return { value: null, error: membershipWalletError(failure) }; } })(),
  ]);
  return <main className="grid gap-6 p-4 md:p-6 lg:p-8"><header className="grid gap-2"><span className="flex items-center gap-2 text-sm font-semibold text-primary"><Certificate aria-hidden size={18} />独立会员权限</span><h1 className="text-3xl font-semibold tracking-tight">会员管理</h1><p className="max-w-[74ch] text-sm leading-6 text-muted-foreground">调整新购买报价、平台额度和导师优惠；按 UID 管理手工授权。购买权益使用独立订单快照，不与手工授权记录混合。</p></header><AdminMembershipWallet key={`wallet:${actor.id}`} actorId={actor.id} initial={wallet.value} initialError={wallet.error} /><details className="rounded-xl border bg-surface p-5"><summary className="flex min-h-11 cursor-pointer items-center text-lg font-semibold">会员基价、数值权益与旧 Stripe 配置</summary><div className="mt-5"><p className="mb-4 text-sm leading-6 text-muted-foreground">新用户使用上方钱包付款；此处保留统一基价、AI 额度与导师折扣设置，以及独立关闭的旧 Stripe 设置。</p><AdminMembershipCommerce key={`commerce:${actor.id}`} actorId={actor.id} initial={commerce.value} initialError={commerce.error} /></div></details><AdminMemberships key={actor.id} actorId={actor.id} initial={manual.value} initialError={manual.error} /></main>;
}

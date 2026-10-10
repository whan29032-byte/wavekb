import type { Metadata } from "next";
import { MembershipPlansCatalog } from "@/components/membership-plans-catalog";
import { getCurrentUser } from "@/lib/auth/dal";
import { parseMembershipCatalog, type MembershipCatalog } from "@/lib/membership/commerce-types";
import { membershipError } from "@/lib/membership/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "会员方案", description: "了解 WaveKB 免费账户、已发布 VIP 方案与一次性会员购买规则。公开知识库和社区阅读保持开放。" };

export default async function MembershipPlansPage() {
  let catalog: MembershipCatalog | null = null; let error = "";
  try {
    const result = await (await createClient()).rpc("list_membership_catalog");
    if (result.error) throw result.error;
    catalog = parseMembershipCatalog(result.data);
  } catch (failure) { error = membershipError(failure); }
  const user = await getCurrentUser();
  return <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-6 md:py-12"><header className="grid gap-3"><p className="text-sm font-medium text-primary">WaveKB 账户与服务</p><h1 className="text-3xl font-semibold tracking-tight">会员方案</h1><p className="max-w-[74ch] text-muted-foreground">免费账户与 VIP 会员各有清晰边界，公开内容不会变成付费阅读。</p></header><MembershipPlansCatalog catalog={catalog} error={error} signedIn={Boolean(user)} /></main>;
}

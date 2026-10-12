import type { Metadata } from "next";
import { MembershipPlansCatalog } from "@/components/membership-plans-catalog";
import { getCurrentUser } from "@/lib/auth/dal";
import { parseMembershipCatalog, type MembershipCatalog } from "@/lib/membership/commerce-types";
import { parseWalletCatalog, type WalletCatalog } from "@/lib/membership/wallet-types";
import { membershipError } from "@/lib/membership/types";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/member/server-repository";
import { personalCenterPath } from "@/lib/member/personal-center-path";

export const metadata: Metadata = { title: "VIP 会员方案", description: "了解 WaveKB 已发布 VIP 方案与一次性购买规则，在个人中心开通和管理会员。原有账号及公开内容保持不变。" };

export default async function MembershipPlansPage() {
  let catalog: MembershipCatalog | null = null; let error = "";
  let walletCatalog: WalletCatalog | null = null; let walletError = "";
  try {
    const client = await createClient();
    const [catalogResult, walletResult] = await Promise.allSettled([
      (async () => {
        const result = await client.rpc("list_membership_catalog");
        if (result.error) throw result.error;
        return parseMembershipCatalog(result.data);
      })(),
      (async () => {
        const result = await client.rpc("list_membership_wallet_routes");
        if (result.error) throw result.error;
        return parseWalletCatalog(result.data);
      })(),
    ]);
    if (catalogResult.status === "fulfilled") catalog = catalogResult.value;
    else error = membershipError(catalogResult.reason);
    if (walletResult.status === "fulfilled") walletCatalog = walletResult.value;
    else walletError = "钱包付款状态待核实。请稍后重新打开本页，或前往个人中心核对。";
  } catch (failure) {
    error = membershipError(failure);
    walletError = "钱包付款状态待核实。请稍后重新打开本页，或前往个人中心核对。";
  }
  const user = await getCurrentUser();
  const profile = user ? await getMyProfile(user.id).catch(() => null) : null;
  return <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:px-6 md:py-12"><header className="grid gap-3"><p className="text-sm font-medium text-primary">WaveKB VIP</p><h1 className="text-3xl font-semibold tracking-tight">会员方案</h1><p className="max-w-[74ch] text-muted-foreground">会员在个人中心开通，使用原有注册账号。公开内容继续免费阅读。</p></header><MembershipPlansCatalog catalog={catalog} error={error} walletCatalog={walletCatalog} walletError={walletError} signedIn={Boolean(user)} personalCenterHref={user ? personalCenterPath(user.id, profile) : undefined} /></main>;
}

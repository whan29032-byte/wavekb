import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, PageHeader } from "@wavekb/ui";
import { TradexMarketFrame } from "@/components/trading/tradex-market-frame";
import { requireActiveMember } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { tradingChartAvailability, workbenchLiveMarketOrigin } from "@/lib/trading/config";
import { DEFAULT_TRADEX_MARKET } from "@/lib/trading/tradex-bridge";

export const metadata: Metadata = { title: "实时行情" };

export default async function LiveMarketPage() {
  const member = await requireActiveMember("/workbench/market");
  if (!workbenchLiveMarketOrigin(member.publicUid, true)) notFound();
  const availability = await tradingChartAvailability(undefined, async () => {
    const client = await createClient();
    const { data: { session } } = await client.auth.getSession();
    return session?.user.id === member.id ? session.access_token : null;
  });
  const origin = workbenchLiveMarketOrigin(member.publicUid, availability.chart);
  if (!origin) notFound();

  return <main className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-8 sm:px-6">
    <PageHeader title="实时行情" description="币安 U 本位永续合约的公开成交行情，不需要绑定账户。" actions={<Button asChild variant="secondary"><Link href="/workbench">返回交易工作台</Link></Button>} />
    <TradexMarketFrame origin={origin} market={DEFAULT_TRADEX_MARKET} />
  </main>;
}

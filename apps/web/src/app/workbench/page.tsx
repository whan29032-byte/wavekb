import type { Metadata } from "next";
import { LegacyWorkbenchHome } from "@/components/legacy-workbench-home";
import { TradingWorkbenchDashboard } from "@/components/trading-workbench-dashboard";
import { requireActiveMember } from "@/lib/auth/dal";
import { tradingChartAvailability, tradingWorkbenchV2Enabled, workbenchLiveMarketOrigin } from "@/lib/trading/config";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "交易工作台" };
export const dynamic = "force-dynamic";

type WorkbenchSearchParams = {
  type?: string | string[];
  page?: string | string[];
  analysisPage?: string | string[];
};

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<WorkbenchSearchParams>;
}) {
  const actor = await requireActiveMember("/workbench");
  if (await tradingWorkbenchV2Enabled()) {
    const marketConfigured = workbenchLiveMarketOrigin(actor.publicUid, true);
    const liveMarketEnabled = marketConfigured ? (await tradingChartAvailability(undefined, async () => {
      const client = await createClient();
      const { data: { session } } = await client.auth.getSession();
      return session?.user.id === actor.id ? session.access_token : null;
    })).chart : false;
    return <TradingWorkbenchDashboard actorId={actor.id} liveMarketEnabled={liveMarketEnabled} />;
  }
  return <LegacyWorkbenchHome actorId={actor.id} searchParams={await searchParams} />;
}

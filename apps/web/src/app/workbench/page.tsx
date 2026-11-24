import type { Metadata } from "next";
import { LegacyWorkbenchHome } from "@/components/legacy-workbench-home";
import { TradingWorkbenchDashboard } from "@/components/trading-workbench-dashboard";
import { requireActiveMember } from "@/lib/auth/dal";
import { tradingWorkbenchV2Enabled } from "@/lib/trading/config";

export const metadata: Metadata = { title: "交易工作台" };

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
    return <TradingWorkbenchDashboard actorId={actor.id} />;
  }
  return <LegacyWorkbenchHome actorId={actor.id} searchParams={await searchParams} />;
}

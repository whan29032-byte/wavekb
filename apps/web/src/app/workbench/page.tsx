import { TradingWorkbenchDashboard } from "@/components/trading-workbench-dashboard";
import { requireActiveMember } from "@/lib/auth/dal";

export default async function WorkbenchPage() {
  const actor = await requireActiveMember("/workbench");
  return <TradingWorkbenchDashboard actorId={actor.id} />;
}

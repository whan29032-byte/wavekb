import { TradingTradeReview } from "@/components/trading-trade-review";
import { requireActiveMember } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { tradingFillChartEnabled } from "@/lib/trading/config";

export default async function TradingTradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireActiveMember(`/workbench/trades/${id}`);
  const chartEnabled = await tradingFillChartEnabled(undefined, async () => {
    const client = await createClient();
    const { data: { session } } = await client.auth.getSession();
    return session?.user.id === member.id ? session.access_token : null;
  });
  return <TradingTradeReview tradeId={id} chartEnabled={chartEnabled} />;
}

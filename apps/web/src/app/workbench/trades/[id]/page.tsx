import { TradingTradeReview } from "@/components/trading-trade-review";
import { requireActiveMember } from "@/lib/auth/dal";
import { tradingFillChartEnabled } from "@/lib/trading/config";

export default async function TradingTradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireActiveMember(`/workbench/trades/${id}`);
  return <TradingTradeReview tradeId={id} chartEnabled={await tradingFillChartEnabled()} />;
}

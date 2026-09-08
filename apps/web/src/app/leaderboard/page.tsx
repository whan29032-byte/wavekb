import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck, TrendUp } from "@phosphor-icons/react/dist/ssr";
import { ExchangeConnectionPanel } from "@/components/exchange-connection";
import { IdentityName, Nameplate } from "@/components/nameplate";
import { getOptionalActiveMember } from "@/lib/auth/dal";
import { listTradingLeaderboard } from "@/lib/trading/server-repository";

export const metadata: Metadata = {
  title: "交易收益排行榜",
  description: "按币安 U 本位合约只读账户绑定以来的最新时间加权收益率排序。",
};

function percent(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
  }).format(value);
}

function money(value: string) {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d*))?$/);
  if (!match) return "0.00 USDT";
  const integer = (match[2] || "0").replace(/^0+(?=\d)/, "");
  const fraction = (match[3] || "").padEnd(3, "0");
  const centsPerUnit = BigInt(100);
  const zero = BigInt(0);
  let cents = BigInt(integer) * centsPerUnit + BigInt(fraction.slice(0, 2));
  if (fraction[2] >= "5") cents += BigInt(1);
  const units = (cents / centsPerUnit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = (cents % centsPerUnit).toString().padStart(2, "0");
  const sign = match[1] && cents !== zero ? "-" : "";
  return `${sign}${units}.${decimals} USDT`;
}

function synchronizedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export default async function TradingLeaderboardPage() {
  const [actor, entries] = await Promise.all([
    getOptionalActiveMember(),
    listTradingLeaderboard(),
  ]);

  return (
    <main className="mx-auto grid max-w-6xl gap-9 px-4 py-10 md:px-6 md:py-14">
      <header className="grid gap-4 border-b pb-8">
        <span className="flex items-center gap-2 text-sm font-semibold text-primary">
          <TrendUp aria-hidden size={19} weight="duotone" />真实账户实时观察排行
        </span>
        <h1 className="max-w-[18ch] text-3xl font-semibold leading-tight tracking-[-0.04em] md:text-5xl">交易收益排行榜</h1>
        <p className="max-w-[70ch] text-sm leading-7 text-muted-foreground">按账户绑定以来的最新时间加权收益率排序。公开当前账户权益和累计盈利；不公开仓位、订单、交易明细、资金流水或 API 信息。排行榜是实时观察，不构成业绩承诺或跟单建议。</p>
      </header>

      <ExchangeConnectionPanel actorId={actor?.id ?? null} />

      <section className="grid gap-5" aria-labelledby="trading-board-title">
        <header>
          <h2 id="trading-board-title" className="text-2xl font-semibold">收益排名</h2>
          <p className="mt-1 text-sm text-muted-foreground">绑定并选择公开后立即进入实时榜；收益率、账户权益和累计盈利随最新同步快照更新。</p>
        </header>
        <div className="overflow-x-auto border-y">
          <div className="min-w-[68rem]">
            <div className="grid grid-cols-[3.5rem_minmax(13rem,1fr)_8rem_11rem_11rem_10rem_2rem] gap-3 px-3 py-3 text-xs font-medium text-muted-foreground">
              <span>排名</span><span>用户</span><span className="text-right">实时收益率</span><span className="text-right">当前权益</span><span className="text-right">累计盈利</span><span className="text-right">最近同步</span><span />
            </div>
            {entries.length ? entries.map((entry) => (
              <Link key={entry.user_id} href={`/member/${entry.public_uid}`} className="grid grid-cols-[3.5rem_minmax(13rem,1fr)_8rem_11rem_11rem_10rem_2rem] items-center gap-3 border-t px-3 py-4 hover:bg-muted">
                <strong className="tabular-nums">{String(entry.rank_no).padStart(2, "0")}</strong>
                <span className="identity-line min-w-0"><IdentityName profile={entry} as="strong" className="truncate text-sm" /><Nameplate uid={entry.public_uid} style={entry.nameplate_style} compact /></span>
                <strong className={`text-right tabular-nums ${entry.return_rate >= 0 ? "text-primary" : "text-destructive"}`}>{percent(entry.return_rate)}</strong>
                <span className="text-right text-sm tabular-nums">{money(entry.current_equity_usdt)}</span>
                <strong className={`text-right text-sm tabular-nums ${entry.cumulative_profit_usdt.startsWith("-") ? "text-destructive" : "text-primary"}`}>{money(entry.cumulative_profit_usdt)}</strong>
                <time dateTime={entry.last_synced_at} className="text-right text-sm tabular-nums text-muted-foreground">{synchronizedAt(entry.last_synced_at)}</time>
                <ArrowRight aria-hidden size={16} className="text-muted-foreground" />
              </Link>
            )) : <p className="border-t px-3 py-10 text-center text-sm text-muted-foreground">暂时没有已公开并保持同步的绑定账户。</p>}
          </div>
        </div>
      </section>

      <section className="grid gap-4 border-t pt-7" aria-labelledby="method-title">
        <h2 id="method-title" className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck aria-hidden size={20} className="text-primary" />计算与风控边界</h2>
        <div className="grid gap-x-8 gap-y-4 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
          <p>从绑定时的基准快照开始，每个同步区间使用（期末权益 − 净转入转出 − 期初权益）÷ 期初权益，再连乘得到绑定至今收益率。</p>
          <p>累计盈利 = 当前权益 − 绑定时权益 − 绑定后的净转入转出。它是绝对金额，与时间加权收益率不是简单相乘关系。</p>
          <p>只支持币安 U 本位合约单资产保证金模式；非 USDT 资金流会暂停排名，避免汇率估算造成误导。</p>
          <p>同步异常超过 6 小时、账户停用或用户关闭公开展示时，排行自动隐藏。</p>
          <p>平台只验证读取能力，无法证明 API 没有额外交易权限；用户必须在币安侧关闭交易与提现并使用 IP 白名单。</p>
        </div>
      </section>
    </main>
  );
}

import Link from "next/link";
import { Certificate } from "@phosphor-icons/react/dist/ssr";
import type { MembershipCatalog } from "@/lib/membership/commerce-types";
import { authContinuationPath } from "@/lib/auth/return-path";

export function membershipMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2 }).format(amountMinor / 100);
}

export function membershipDiscount(basisPoints: number) {
  return basisPoints === 0 ? "按导师原价" : `导师优惠 ${basisPoints / 100}%（${(10000 - basisPoints) / 1000} 折）`;
}

export function MembershipPlansCatalog({ catalog, error = "", signedIn = false, personalCenterHref = "/member/profile" }: { catalog: MembershipCatalog | null; error?: string; signedIn?: boolean; personalCenterHref?: string }) {
  return <div className="grid gap-8">
    <section className="grid gap-4" aria-labelledby="paid-membership-title">
      <div className="grid gap-2"><h2 id="paid-membership-title" className="flex items-center gap-2 text-xl font-semibold"><Certificate aria-hidden size={24} />VIP 会员方案</h2><p className="text-sm leading-6 text-muted-foreground">VIP 在个人中心开通和管理，沿用现有站内账号，无需重新注册。月度或年度为一次性购买，不自动续费。</p><Link className="inline-flex min-h-11 w-fit items-center rounded-lg border px-4 py-2 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={signedIn ? personalCenterHref : authContinuationPath("/login", "/member/profile")}>{signedIn ? "前往个人中心" : "登录后前往个人中心"}</Link></div>
      {!catalog ? <p role="alert" className="rounded-xl border border-dashed p-5 text-sm leading-6 text-muted-foreground">{error || "暂时无法读取公开会员方案，请稍后重新打开本页。"} 未核实方案或价格时，不会提供购买入口。</p> : <>
        {!catalog.purchase_available ? <p role="status" className="rounded-xl border bg-muted/40 p-4 text-sm leading-6">付款尚未开放。已发布的方案可供了解，不能在此完成购买。</p> : <p className="text-sm text-muted-foreground">{catalog.payment_mode === "test" ? "当前为测试付款模式，测试订单不会授予正式 VIP 权益。" : "请在个人中心核对当前账号与报价，再开通 VIP。"}</p>}
        {catalog.plans.length ? <div className="grid gap-4 md:grid-cols-2">{catalog.plans.map((plan) => <article key={plan.key} className="grid content-start gap-4 rounded-xl border bg-surface p-5 md:p-6"><h3 className="text-lg font-semibold">{plan.title}</h3>{plan.description ? <p className="text-sm leading-6 text-muted-foreground">{plan.description}</p> : null}<dl className="grid gap-2 text-sm"><div><dt className="text-muted-foreground">AI 平台额度</dt><dd>{plan.ai_daily_limit > 0 ? `每日 ${plan.ai_daily_limit} 次` : "未配置平台额度"}</dd></div><div><dt className="text-muted-foreground">导师订单</dt><dd>{membershipDiscount(plan.mentor_discount_bps)}</dd></div></dl><p className="text-xs leading-5 text-muted-foreground">免费自带 Key 的 AI 使用不扣此平台额度。导师优惠以服务端结算报价为准。</p>{Object.keys(plan.benefits).length ? <div className="grid gap-2"><h4 className="text-sm font-medium">方案补充说明</h4><ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">{Object.entries(plan.benefits).map(([key, value]) => <li key={key}>{value}</li>)}</ul></div> : null}
          {plan.prices.length ? <ul className="grid gap-3">{plan.prices.map((price) => <li key={price.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-semibold">{membershipMoney(price.amount_minor, price.currency)} <span className="text-sm font-normal text-muted-foreground">/ {price.term_months === 1 ? "1 个月" : "12 个月"}</span></p><p className="text-xs text-muted-foreground">一次性付款 · 不自动续费</p></div><span className="text-sm text-muted-foreground">{catalog.purchase_available ? "在个人中心开通" : "尚未开放付款"}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">此方案尚未发布价格。</p>}
        </article>)}</div> : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">暂无已发布的 VIP 方案，原有账号和公开内容不受影响。</p>}
      </>}
    </section>
  </div>;
}

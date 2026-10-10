import Link from "next/link";
import { Certificate } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@wavekb/ui";

/** Render only within the authenticated owner's private personal-center page. */
export function MembershipPersonalCenterEntry() {
  return <section className="flex flex-col gap-4 rounded-xl border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="personal-center-vip-title">
    <div className="grid gap-1"><h2 id="personal-center-vip-title" className="flex items-center gap-2 text-xl font-semibold"><Certificate aria-hidden size={22} />VIP 会员</h2><p className="text-sm leading-6 text-muted-foreground">查看会员权益与订单，按需开通月度或年度方案。</p></div>
    <Button asChild variant="secondary" className="min-h-11 shrink-0"><Link href="/membership">开通 / 管理 VIP</Link></Button>
  </section>;
}

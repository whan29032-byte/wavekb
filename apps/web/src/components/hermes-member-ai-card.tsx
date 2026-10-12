import Link from "next/link";

export function HermesMemberAiCard() {
  return <section aria-labelledby="hermes-member-ai-title" className="grid gap-4 rounded-xl border bg-surface p-5 md:p-7">
    <header className="flex flex-wrap items-center gap-3">
      <h2 id="hermes-member-ai-title" className="text-xl font-semibold">Hermes 云端研究</h2>
      <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">会员专属</span>
    </header>
    <p className="max-w-[72ch] text-sm leading-6 text-muted-foreground">与个人模型接口分开的云端研究服务，由网站独立运行，无需填写个人 API Key。有效 VIP 可在分析步骤中选择 Hermes，使用会员每日额度；可用状态和额度均由服务器核实。</p>
    <p className="text-xs leading-5 text-muted-foreground">仅提供研究分析，不连接本机 Hermes，不开放终端、微信、文件操作或交易工具。书籍与补充理论的实际采用情况以当前分析的检索结果为准，不代表模型已训练或结论已验证。</p>
    <div className="flex flex-wrap gap-3">
      <Link href="/workbench" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">前往分析，选择 Hermes</Link>
      <Link href="/membership" className="inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">查看我的会员与额度</Link>
    </div>
  </section>;
}

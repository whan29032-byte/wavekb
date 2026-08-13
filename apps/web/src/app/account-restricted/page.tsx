import type { Metadata } from "next";
import Link from "next/link";
import { Prohibit } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@wavekb/ui";

export const metadata: Metadata = { title: "账号访问受限", robots: { index: false, follow: false } };

export default function AccountRestrictedPage() {
  return (
    <main className="mx-auto grid max-w-xl justify-items-start gap-5 px-4 py-20 md:px-6">
      <Prohibit aria-hidden size={38} weight="duotone" className="text-destructive" />
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">账号访问已受限</h1>
        <p className="text-sm leading-7 text-muted-foreground">当前账号已被管理员暂停使用。网站不会继续加载好友、消息、工作台或其他账户数据；如有疑问，请联系网站管理员。</p>
      </div>
      <Button asChild variant="secondary"><Link href="/">返回首页</Link></Button>
    </main>
  );
}

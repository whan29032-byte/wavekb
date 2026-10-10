import Link from "next/link";
import { BookOpenText, ChatsCircle, Coins, Notebook, UsersThree } from "@phosphor-icons/react/dist/ssr";

const services = [
  { href: "/knowledge", title: "阅读知识库", description: "已有公开书籍与知识内容无需 VIP，也无需注册即可阅读。", Icon: BookOpenText },
  { href: "/community/idea_sharing/new", title: "发布社区内容", description: "免费注册后分享观点与研究，现有发布规则保持不变。", Icon: ChatsCircle },
  { href: "/workbench", title: "使用私人工作台", description: "保存自己的复盘、日记、研究草稿与分析记录。", Icon: Notebook },
  { href: "/friends", title: "管理好友", description: "处理好友请求，并与已建立好友关系的用户交流。", Icon: UsersThree },
  { href: "/rewards", title: "查看积分商城", description: "查看真实研究积分与可兑换项目；兑换仍按原有规则进行。", Icon: Coins },
];

export function MembershipServices() {
  return <section className="grid gap-4" aria-labelledby="membership-services-title">
    <header className="grid gap-2"><h2 id="membership-services-title" className="text-xl font-semibold">免费账户可用服务</h2><p className="text-sm leading-6 text-muted-foreground">VIP 授权到期或撤销不会移除已有免费账户功能。下列入口不是新增付费权益。</p></header>
    <ul className="grid gap-3 sm:grid-cols-2">{services.map(({ href, title, description, Icon }) => <li key={href}><Link href={href} className="flex min-h-11 h-full gap-3 rounded-xl border bg-surface p-4 hover:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon aria-hidden size={20} className="mt-1 shrink-0 text-primary" /><span className="grid gap-1"><strong className="text-sm font-semibold">{title}</strong><span className="text-sm leading-6 text-muted-foreground">{description}</span></span></Link></li>)}</ul>
  </section>;
}

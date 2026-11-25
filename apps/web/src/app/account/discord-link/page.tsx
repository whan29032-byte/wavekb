import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { getCurrentUser, requireActiveMember } from "@/lib/auth/dal";
import { DiscordLinkClient, DiscordLinkTokenCleaner } from "./discord-link-client";

export const metadata: Metadata = {
  title: "绑定 Discord",
  referrer: "no-referrer",
};

type SearchValue = string | string[] | undefined;

function first(value: SearchValue) {
  return typeof value === "string" ? value : null;
}

const statusCopy: Record<string, { title: string; description: string }> = {
  linked: {
    title: "Discord 账号已绑定",
    description: "绑定已经生效。回到 Discord 运行 /网站账号，即可查看网站资料并同步已配置的普通身份组。",
  },
  expired: {
    title: "绑定链接已过期",
    description: "请回到 Discord 重新运行 /绑定网站，获取新的 10 分钟单次链接。",
  },
  used: {
    title: "绑定链接已使用",
    description: "这个链接不能再次使用。如需改绑，请回到 Discord 重新运行 /绑定网站。",
  },
  revoked: {
    title: "绑定链接已失效",
    description: "你已经申请了更新的绑定链接，请使用最新的一条。",
  },
  conflict: {
    title: "该 Discord 已绑定其他账号",
    description: "为保护账号安全，同一个 Discord 账号不能同时绑定多个 WaveKB 账号。",
  },
  restricted: {
    title: "当前账号无法绑定",
    description: "此 WaveKB 账号目前处于受限状态，绑定没有发生。",
  },
  invalid: {
    title: "绑定链接无效",
    description: "链接格式不正确。请只使用机器人刚刚发给你的绑定按钮。",
  },
  error: {
    title: "暂时无法完成绑定",
    description: "网站没有修改绑定，请稍后回到 Discord 重新尝试。",
  },
};

export default async function DiscordLinkPage({ searchParams }: {
  searchParams: Promise<{ status?: SearchValue }>;
}) {
  const query = await searchParams;
  const status = first(query.status);
  const state = status ? statusCopy[status] : null;
  if (state) {
    return (
      <>
        <DiscordLinkTokenCleaner />
        <AuthCard title={state.title} description={state.description}>
          <Link className="rounded-lg bg-primary px-4 py-3 text-center font-semibold text-primary-foreground hover:bg-primary-hover" href="/member/profile">
            返回个人中心
          </Link>
        </AuthCard>
      </>
    );
  }

  const user = await getCurrentUser();
  const actor = user ? await requireActiveMember("/account/discord-link") : null;
  return <DiscordLinkClient publicUid={actor?.publicUid ?? null} />;
}

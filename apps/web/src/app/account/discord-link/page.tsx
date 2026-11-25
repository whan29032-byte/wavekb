import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { requireActiveMember } from "@/lib/auth/dal";
import { isDiscordLinkToken } from "@/lib/discord-integration/security";

export const metadata: Metadata = { title: "绑定 Discord" };

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
  searchParams: Promise<{ token?: SearchValue; status?: SearchValue }>;
}) {
  const query = await searchParams;
  const token = first(query.token);
  const status = first(query.status);
  const returnPath = status
    ? `/account/discord-link?status=${encodeURIComponent(status)}`
    : token
      ? `/account/discord-link?token=${encodeURIComponent(token)}`
      : "/account/discord-link";
  const actor = await requireActiveMember(returnPath);

  const state = status ? statusCopy[status] : null;
  if (state) {
    return (
      <AuthCard title={state.title} description={state.description}>
        <Link className="rounded-lg bg-primary px-4 py-3 text-center font-semibold text-primary-foreground hover:bg-primary-hover" href="/member/profile">
          返回个人中心
        </Link>
      </AuthCard>
    );
  }

  if (!isDiscordLinkToken(token)) {
    return (
      <AuthCard title={statusCopy.invalid.title} description={statusCopy.invalid.description}>
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">没有任何账号数据被修改。</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="绑定 WaveKB 与 Discord"
      description="确认后，悠悠的宝宝可以读取你的公开资料、称号、铭牌和积分，用于 Discord 内展示与普通身份组同步。"
    >
      <div className="grid gap-4">
        <p className="rounded-lg bg-muted px-4 py-3 text-sm">
          当前登录账号：<strong>UID {actor.publicUid}</strong>
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          机器人不会读取邮箱、密码或私密内容；原有 Discord 经验和阵营等级也不会被网站覆盖。
        </p>
        <form action="/api/integrations/discord/redeem" method="post">
          <input name="token" type="hidden" value={token} />
          <button className="w-full rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground hover:bg-primary-hover" type="submit">
            确认绑定 Discord
          </button>
        </form>
      </div>
    </AuthCard>
  );
}

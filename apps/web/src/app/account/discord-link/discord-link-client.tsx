"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthCard } from "@/components/auth-card";

const storageKey = "wavekb.discord-link-token.v1";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function validToken(value: string | null): value is string {
  return typeof value === "string" && tokenPattern.test(value);
}

function clearFragment() {
  if (!window.location.hash) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

function removeStoredToken() {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Storage may be unavailable in hardened browser modes. The database token
    // remains short-lived and single-use; no secret is copied to another URL.
  }
}

function storeToken(token: string) {
  try {
    window.sessionStorage.setItem(storageKey, token);
  } catch {
    // An already authenticated user can still complete the current tab flow.
  }
}

function storedToken() {
  try {
    return window.sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function DiscordLinkTokenCleaner() {
  useEffect(() => {
    clearFragment();
    removeStoredToken();
  }, []);
  return null;
}

export function DiscordLinkClient({ publicUid }: { publicUid: number | null }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const hadFragment = window.location.hash.length > 0;
    const fragmentToken = hadFragment
      ? new URLSearchParams(window.location.hash.slice(1)).get("token")
      : null;
    clearFragment();

    let resolvedToken: string | null;
    if (hadFragment) {
      if (validToken(fragmentToken)) {
        storeToken(fragmentToken);
        resolvedToken = fragmentToken;
      } else {
        removeStoredToken();
        resolvedToken = null;
      }
    } else {
      const previous = storedToken();
      if (validToken(previous)) {
        resolvedToken = previous;
      } else {
        removeStoredToken();
        resolvedToken = null;
      }
    }

    const update = window.setTimeout(() => setToken(resolvedToken), 0);
    return () => window.clearTimeout(update);
  }, []);

  if (token === undefined) {
    return (
      <AuthCard title="正在保护绑定链接" description="正在从地址栏安全接收一次性凭证。">
        <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">请稍候…</p>
      </AuthCard>
    );
  }

  if (!token) {
    return (
      <AuthCard title="绑定链接无效" description="链接格式不正确。请只使用机器人刚刚发给你的绑定按钮。">
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">没有任何账号数据被修改。</p>
      </AuthCard>
    );
  }

  if (publicUid === null) {
    return (
      <AuthCard title="登录后绑定 Discord" description="一次性凭证仅保留在当前浏览器标签页，不会写入登录地址或服务器访问日志。">
        <Link
          className="rounded-lg bg-primary px-4 py-3 text-center font-semibold text-primary-foreground hover:bg-primary-hover"
          href="/login?next=%2Faccount%2Fdiscord-link"
        >
          登录后继续
        </Link>
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
          当前登录账号：<strong>UID {publicUid}</strong>
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

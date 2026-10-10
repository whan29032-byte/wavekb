import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/components/login-form";
import { authContinuationPath } from "@/lib/auth/return-path";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ next?: string | string[] }> } = {}) {
  const query = await searchParams;
  const returnPath = typeof query?.next === "string" ? query.next : undefined;
  return (
    <AuthCard
      title="登录 WaveKB"
      description="邮箱和公开 UID 都可以登录。会话由服务端安全写入 Cookie。"
      footer={<span><Link className="font-semibold text-primary hover:underline" href={authContinuationPath("/register", returnPath)}>创建账号</Link><span className="px-2" aria-hidden="true">·</span><Link className="font-semibold text-primary hover:underline" href="/recover">忘记密码</Link></span>}
    >
      <Suspense><LoginForm /></Suspense>
    </AuthCard>
  );
}

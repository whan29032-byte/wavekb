import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return (
    <main className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl place-items-center px-4 py-12 md:px-6">
      <section className="grid w-full max-w-md gap-7 rounded-xl border bg-surface p-6 md:p-8">
        <header className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">登录 WaveKB</h1>
          <p className="text-sm leading-6 text-muted-foreground">邮箱和公开 UID 都可以登录。会话由服务端安全写入 Cookie。</p>
        </header>
        <Suspense><LoginForm /></Suspense>
      </section>
    </main>
  );
}

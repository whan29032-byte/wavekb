import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata: Metadata = { title: "找回密码" };

export default function RecoverPage() {
  return (
    <AuthCard
      title="重置密码"
      description="输入注册邮箱接收安全链接，或通过邮件中的链接在这里设置新密码。"
      footer={<Link className="font-semibold text-primary hover:underline" href="/login">返回登录</Link>}
    >
      <PasswordRecoveryForm />
    </AuthCard>
  );
}

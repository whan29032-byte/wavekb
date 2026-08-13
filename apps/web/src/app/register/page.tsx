import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { RegistrationForm } from "@/components/registration-form";

export const metadata: Metadata = { title: "创建账号" };

export default function RegisterPage() {
  return (
    <AuthCard
      title="加入 WaveKB"
      description="先验证邮箱并设置密码，然后从候选号码中选择你的公开 UID。"
      footer={<Link className="font-semibold text-primary hover:underline" href="/login">已有账号，返回登录</Link>}
    >
      <RegistrationForm />
    </AuthCard>
  );
}

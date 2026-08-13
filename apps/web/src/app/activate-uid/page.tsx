import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { UidActivationForm } from "@/components/uid-activation-form";
import { requireCurrentUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/auth/forms";

export const metadata: Metadata = { title: "激活 UID" };

export default async function ActivateUidPage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const query = await searchParams;
  const next = typeof query.next === "string" ? safeReturnPath(query.next) : "/community/idea_sharing";
  const user = await requireCurrentUser(`/activate-uid?next=${encodeURIComponent(next)}`);
  const supabase = await createClient();
  const profile = await supabase.from("profiles").select("public_uid").eq("id", user.id).maybeSingle();
  if (profile.data?.public_uid != null) redirect(next);
  return (
    <AuthCard title="选择你的 UID" description="这是你在 WaveKB 的公开登录号码。四个候选号码会为当前账号临时保留。">
      <Suspense fallback={<p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">正在生成候选 UID</p>}>
        <UidActivationForm />
      </Suspense>
    </AuthCard>
  );
}

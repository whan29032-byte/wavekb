import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileEditor } from "@/components/profile-editor";
import { requireActiveMember } from "@/lib/auth/dal";
import { getMyNameplates, getMyProfile } from "@/lib/member/server-repository";

export const metadata: Metadata = { title: "编辑个人资料" };

export default async function EditMemberProfilePage() {
  const actor = await requireActiveMember("/member/profile");
  const [profile, nameplates] = await Promise.all([
    getMyProfile(actor.id),
    getMyNameplates().catch(() => []),
  ]);
  if (!profile) notFound();
  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:px-6 md:py-14">
      <header className="grid gap-2"><h1 className="text-3xl font-semibold tracking-[-0.035em] md:text-4xl">编辑个人资料</h1><p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">设置公开身份、研究偏好、头像和个人页背景。全部数据继续存放在现有 Supabase 资料表和存储桶中。</p></header>
      <ProfileEditor profile={profile} initialNameplates={nameplates} />
    </main>
  );
}

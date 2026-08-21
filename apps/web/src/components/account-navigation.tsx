"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignOut, UserCircle } from "@phosphor-icons/react";
import type { User } from "@supabase/supabase-js";
import type { PublicProfile } from "@wavekb/domain";
import { Button } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";
import { Nameplate } from "@/components/nameplate";

export function AccountNavigation() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function applyUser(nextUser: User | null) {
      if (!active) return;
      setUser(nextUser);
      if (!nextUser) {
        setProfile(null);
        return;
      }
      const client = createClient();
      const result = await client.from("profiles").select("id,public_uid,display_name,avatar_url,role,display_title,nameplate_style").eq("id", nextUser.id).maybeSingle();
      if (active) setProfile((result.data as PublicProfile | null) ?? null);
    }
    try {
      const client = createClient();
      void client.auth.getSession().then(({ data }) => {
        void applyUser(data.session?.user ?? null);
      });
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        queueMicrotask(() => void applyUser(session?.user ?? null));
      });
      return () => {
        active = false;
        data.subscription.unsubscribe();
      };
    } catch {
      return () => {
        active = false;
      };
    }
  }, []);

  async function signOut() {
    setPending(true);
    setError("");
    try {
      const result = await createClient().auth.signOut();
      if (result.error) throw result.error;
      setUser(null);
      router.replace("/");
      router.refresh();
    } catch {
      setError("退出失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  if (!user) {
    return (
      <Link href="/login" className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
        <UserCircle aria-hidden size={18} weight="duotone" />登录
      </Link>
    );
  }

  return (
    <span className="relative flex items-center">
      <details className="group relative md:hidden">
        <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="账户菜单"><UserCircle aria-hidden size={20} /></summary>
        <nav className="absolute right-0 top-12 z-40 grid w-48 gap-1 rounded-xl border bg-surface p-2 shadow-xl" aria-label="账户导航">
          {profile?.public_uid ? <Link href={`/member/${profile.public_uid}`} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-muted"><UserCircle aria-hidden size={18} />个人空间 <Nameplate uid={profile.public_uid} style={profile.nameplate_style} compact /></Link> : null}
          <button type="button" className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-destructive hover:bg-muted disabled:opacity-55" onClick={signOut} disabled={pending} aria-describedby={error ? "sign-out-error" : undefined}><SignOut aria-hidden size={18} />{pending ? "正在退出" : "退出登录"}</button>
        </nav>
      </details>
      <span className="hidden items-center gap-1 md:flex">
        {profile?.public_uid ? <Button asChild variant="ghost" size="small"><Link href={`/member/${profile.public_uid}`}><UserCircle aria-hidden size={18} /><Nameplate uid={profile.public_uid} style={profile.nameplate_style} compact /></Link></Button> : null}
        <Button type="button" variant="ghost" size="small" onClick={signOut} disabled={pending} aria-describedby={error ? "sign-out-error" : undefined}><SignOut aria-hidden size={18} /><span>{pending ? "正在退出" : "退出登录"}</span></Button>
      </span>
      {error ? <span id="sign-out-error" role="alert" className="sr-only">{error}</span> : null}
    </span>
  );
}

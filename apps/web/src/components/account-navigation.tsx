"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Coins, Notebook, SignOut, UserCircle } from "@phosphor-icons/react";
import type { User } from "@supabase/supabase-js";
import { Button } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";

export function AccountNavigation() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [publicUid, setPublicUid] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function applyUser(nextUser: User | null) {
      if (!active) return;
      setUser(nextUser);
      if (!nextUser) {
        setPublicUid(null);
        return;
      }
      const client = createClient();
      const result = await client.from("profiles").select("public_uid").eq("id", nextUser.id).maybeSingle();
      if (active) setPublicUid(typeof result.data?.public_uid === "number" ? result.data.public_uid : null);
    }
    try {
      const client = createClient();
      void client.auth.getUser().then(({ data }) => {
        void applyUser(data.user);
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
      <Link href="/login" className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
        <UserCircle aria-hidden size={18} weight="duotone" />登录
      </Link>
    );
  }

  return (
    <span className="relative flex items-center gap-1">
      <Button asChild variant="ghost" size="small"><Link href="/rewards"><Coins aria-hidden size={18} /><span className="hidden xl:inline">积分</span></Link></Button>
      <Button asChild variant="ghost" size="small"><Link href="/workbench"><Notebook aria-hidden size={18} /><span className="hidden lg:inline">工作台</span></Link></Button>
      {publicUid ? (
        <Button asChild variant="ghost" size="small"><Link href={`/member/${publicUid}`}><UserCircle aria-hidden size={18} /><span className="hidden md:inline">个人空间</span></Link></Button>
      ) : null}
      <Button type="button" variant="ghost" size="small" onClick={signOut} disabled={pending} aria-describedby={error ? "sign-out-error" : undefined}>
        <SignOut aria-hidden size={18} /><span className="hidden md:inline">{pending ? "正在退出" : "退出登录"}</span><span className="sr-only md:hidden">{pending ? "正在退出" : "退出登录"}</span>
      </Button>
      {error ? <span id="sign-out-error" role="alert" className="sr-only">{error}</span> : null}
    </span>
  );
}

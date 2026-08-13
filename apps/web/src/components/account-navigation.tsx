"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignOut, UserCircle } from "@phosphor-icons/react";
import type { User } from "@supabase/supabase-js";
import { Button } from "@wavekb/ui";
import { createClient } from "@/lib/supabase/client";

export function AccountNavigation() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    try {
      const client = createClient();
      void client.auth.getUser().then(({ data }) => {
        if (active) setUser(data.user);
      });
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        if (active) setUser(session?.user ?? null);
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
    <span className="relative">
      <Button type="button" variant="ghost" size="small" onClick={signOut} disabled={pending} aria-describedby={error ? "sign-out-error" : undefined}>
        <SignOut aria-hidden size={18} />{pending ? "正在退出" : "退出登录"}
      </Button>
      {error ? <span id="sign-out-error" role="alert" className="sr-only">{error}</span> : null}
    </span>
  );
}

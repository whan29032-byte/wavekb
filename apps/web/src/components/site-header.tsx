import Link from "next/link";
import { BookOpenText, ChatsCircle, Coins, GraduationCap } from "@phosphor-icons/react/dist/ssr";
import { AccountNavigation } from "@/components/account-navigation";
import { AppearanceSettings } from "@/components/appearance-settings";
import { MobileNavigation } from "@/components/mobile-navigation";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4 md:gap-6 md:px-6">
        <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">W</span>
          <span>WaveKB</span>
        </Link>
        <nav aria-label="主导航" className="ml-auto flex items-center gap-1 text-sm font-medium">
          <MobileNavigation />
          <Link href="/knowledge" className="hidden min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground md:flex">
            <BookOpenText aria-hidden size={18} weight="duotone" />知识库
          </Link>
          <Link href="/community/idea_sharing" aria-label="社区" className="hidden min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-2 text-muted-foreground hover:bg-muted hover:text-foreground md:flex md:px-3">
            <ChatsCircle aria-hidden size={18} weight="duotone" /><span className="hidden sm:inline">社区</span>
          </Link>
          <Link href="/mentors" className="hidden min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground md:flex">
            <GraduationCap aria-hidden size={18} weight="duotone" />导师
          </Link>
          <Link href="/rewards" aria-label="积分商城" className="hidden min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-2 text-muted-foreground hover:bg-muted hover:text-foreground md:flex lg:px-3">
            <Coins aria-hidden size={18} weight="duotone" /><span className="hidden lg:inline">积分商城</span>
          </Link>
          <AppearanceSettings />
          <AccountNavigation />
        </nav>
      </div>
    </header>
  );
}

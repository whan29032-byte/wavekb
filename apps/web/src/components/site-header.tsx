import Link from "next/link";
import { BookOpenText, ChatsCircle, GraduationCap } from "@phosphor-icons/react/dist/ssr";
import { AccountNavigation } from "@/components/account-navigation";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">W</span>
          <span>WaveKB</span>
        </Link>
        <nav aria-label="主导航" className="ml-auto flex items-center gap-1 text-sm font-medium">
          <Link href="/knowledge" className="hidden items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground md:flex">
            <BookOpenText aria-hidden size={18} weight="duotone" />知识库
          </Link>
          <Link href="/community/idea_sharing" className="flex items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChatsCircle aria-hidden size={18} weight="duotone" />社区
          </Link>
          <Link href="/mentors" className="hidden items-center gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:flex">
            <GraduationCap aria-hidden size={18} weight="duotone" />导师
          </Link>
          <AccountNavigation />
        </nav>
      </div>
    </header>
  );
}

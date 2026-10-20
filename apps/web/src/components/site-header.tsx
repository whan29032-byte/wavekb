import { ReadingPriorityLink as Link } from "@/components/reading-priority-link";
import { AccountNavigation } from "@/components/account-navigation";
import { AppearanceSettings } from "@/components/appearance-settings";
import { MobileNavigation } from "@/components/mobile-navigation";
import { SiteNavigation } from "@/components/site-navigation";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:px-6">
        <Link href="/" aria-label="WaveKB 首页" className="flex min-h-11 shrink-0 items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-[var(--radius-control)] bg-primary text-sm font-bold text-primary-foreground shadow-[var(--shadow-xs)]">W</span>
          <span className="text-[0.95rem]">WaveKB</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <MobileNavigation />
          <SiteNavigation />
          <span aria-hidden className="mx-1 hidden h-6 w-px bg-border lg:block" />
          <AppearanceSettings />
          <AccountNavigation />
        </div>
      </div>
    </header>
  );
}

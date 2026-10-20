import type { ReactNode } from "react";
import { cn } from "./cn";

export function PageHeader({ eyebrow, title, description, actions, icon, className }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("grid gap-4 border-b border-border pb-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:pb-8", className)}>
      <div className="grid gap-2">
        {eyebrow || icon ? (
          <div className="flex items-center gap-2">
            {icon}
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          </div>
        ) : null}
        <h1 className="text-title font-semibold tracking-[-0.04em] text-balance">{title}</h1>
        {description ? <p className="max-w-[70ch] text-sm leading-7 text-muted-foreground md:text-base">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div> : null}
    </header>
  );
}

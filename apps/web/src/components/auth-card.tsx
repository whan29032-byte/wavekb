import type { ReactNode } from "react";

export function AuthCard({ title, description, children, footer }: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl place-items-center px-4 py-12 md:px-6">
      <section className="grid w-full max-w-md gap-7 rounded-xl border bg-surface p-6 md:p-8">
        <header className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">{title}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </header>
        {children}
        {footer ? <footer className="border-t pt-5 text-center text-sm text-muted-foreground">{footer}</footer> : null}
      </section>
    </main>
  );
}

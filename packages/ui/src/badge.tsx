import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "./cn";

const badgeVariants = cva(
  "inline-flex w-fit items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-border bg-surface-subtle text-foreground-secondary",
        primary: "border-primary/20 bg-primary-selected text-primary",
        success: "border-success/25 bg-success-surface text-success",
        warning: "border-warning/25 bg-warning-surface text-warning",
        danger: "border-destructive/25 bg-destructive-surface text-destructive",
        outline: "border-border-strong bg-transparent text-foreground-secondary",
      },
      size: {
        sm: "px-2 py-0 text-[11px]",
        md: "",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

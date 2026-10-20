import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "./cn";

const cardVariants = cva("border border-border bg-surface text-foreground", {
  variants: {
    variant: {
      panel: "shadow-card",
      subtle: "bg-surface-subtle shadow-none",
      interactive: "shadow-xs transition-[border-color,box-shadow,background-color] duration-[var(--motion-fast)] hover:border-primary/40 hover:shadow-card-hover",
    },
    padding: {
      none: "",
      sm: "p-4",
      md: "p-5 md:p-6",
      lg: "p-6 md:p-8",
    },
    radius: {
      card: "rounded-card",
      panel: "rounded-panel",
    },
  },
  defaultVariants: { variant: "panel", padding: "md", radius: "card" },
});

export type CardProps = HTMLAttributes<HTMLDivElement>
  & VariantProps<typeof cardVariants>
  & { asChild?: boolean };

export function Card({ asChild, className, variant, padding, radius, ...props }: CardProps) {
  const Component = asChild ? Slot : "div";
  return <Component className={cn(cardVariants({ variant, padding, radius }), className)} {...props} />;
}

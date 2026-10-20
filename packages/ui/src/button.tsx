import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

const buttonVariants = cva(
  "inline-flex min-h-[var(--control-height)] shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] px-4 text-sm font-semibold outline-none transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-55 active:translate-y-px",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-[var(--shadow-xs)] hover:bg-primary-hover",
        secondary: "border border-border-strong bg-surface text-foreground hover:border-primary/35 hover:bg-surface-subtle",
        soft: "border border-primary/15 bg-primary-selected text-primary hover:bg-primary/15",
        outline: "border border-border-strong bg-transparent text-foreground hover:border-primary/35 hover:bg-surface-subtle",
        ghost: "text-muted-foreground hover:bg-surface-subtle hover:text-foreground",
        danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        default: "",
        small: "min-h-9 px-3 text-xs",
        large: "min-h-12 px-5 text-base",
        icon: "size-[var(--control-height)] p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
  & VariantProps<typeof buttonVariants>
  & { asChild?: boolean };

export function Button({ asChild, className, variant, size, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

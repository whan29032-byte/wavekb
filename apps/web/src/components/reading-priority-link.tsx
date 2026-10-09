"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

/** Reading bytes take priority over unclicked navigation destinations. */
export function ReadingPriorityLink(props: ComponentProps<typeof Link>) {
  const pathname = usePathname();
  const reading = pathname === "/knowledge" || pathname?.startsWith("/knowledge/");
  return <Link {...props} prefetch={reading ? false : props.prefetch} />;
}

"use client";

import { useRouter } from "next/navigation";
import { Button } from "@wavekb/ui";

export function ResearchRefresh({ href, alreadyLatest }: { href: string; alreadyLatest: boolean }) {
  const router = useRouter();
  return <Button
    type="button"
    variant="secondary"
    className="min-h-11"
    onClick={() => {
      if (alreadyLatest) router.refresh();
      else router.push(href);
    }}
  >刷新列表</Button>;
}

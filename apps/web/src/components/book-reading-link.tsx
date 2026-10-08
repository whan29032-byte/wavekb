"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

export const BOOK_LOCATION_EVENT = "wavekb:book-location";

function findBookTarget(hash: string) {
  let id: string;
  try { id = decodeURIComponent(hash.replace(/^#/, "")); }
  catch { return null; }
  return document.getElementById(id);
}

export function scrollToBookTarget(hash: string) {
  const target = findBookTarget(hash);
  if (!target) return false;

  for (let ancestor: HTMLElement | null = target; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  }
  target.scrollIntoView({ behavior: "instant", block: "start" });
  target.focus({ preventScroll: true });
  return true;
}

export function navigateToBookTarget(hash: string) {
  if (!findBookTarget(hash)) return false;
  const url = new URL(window.location.href);
  if (url.hash !== hash) {
    url.hash = hash;
    window.history.pushState(window.history.state, "", url);
  }
  scrollToBookTarget(hash);
  window.dispatchEvent(new Event(BOOK_LOCATION_EVENT));
  return true;
}

type BookReadingLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/** Keep native anchors usable without JavaScript; enhance only same-document jumps. */
export function BookReadingLink({ href, onClick, ...props }: BookReadingLinkProps) {
  if (!href.startsWith("#")) return <Link href={href} prefetch={false} onClick={onClick} {...props} />;

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (props.target && props.target !== "_self")) return;
    // A missing target should never suppress the browser's native fallback.
    if (navigateToBookTarget(href)) event.preventDefault();
  }

  return <a href={href} onClick={handleClick} {...props} />;
}

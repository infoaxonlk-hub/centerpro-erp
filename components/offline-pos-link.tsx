"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

export function OfflinePosLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  function openAsDocument(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // A full navigation lets the service worker cache the authenticated POS page for offline reopen.
    window.location.assign(href);
  }
  return <Link href={href} prefetch={false} className={className} onClick={openAsDocument}>{children}</Link>;
}

"use client";

import type { MouseEvent, ReactNode } from "react";

import { useDashboardNavigation } from "./dashboard-navigation";

/**
 * A plain link that, with JavaScript, navigates through the dashboard transition so the page
 * stays readable while loading and the update is announced. Modified clicks (new tab, new
 * window) keep the browser's default behaviour.
 */
export function DashboardLink({
  href,
  children,
  className,
  ...rest
}: {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  "aria-current"?: "page" | "true";
}) {
  const { navigate } = useDashboardNavigation();
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }
  return (
    <a href={href} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  );
}

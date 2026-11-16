"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A section heading that takes focus when `focusKey` changes after the first render, for
 * example after moving to another page of a list, so keyboard and screen-reader users land at
 * the start of the new results instead of on a pagination link that may have moved.
 */
export function FocusHeading({ id, focusKey, children, className }: { id: string; focusKey: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const previous = useRef(focusKey);
  useEffect(() => {
    if (previous.current !== focusKey) ref.current?.focus();
    previous.current = focusKey;
  }, [focusKey]);
  return (
    <h2 ref={ref} id={id} tabIndex={-1} className={className}>
      {children}
    </h2>
  );
}

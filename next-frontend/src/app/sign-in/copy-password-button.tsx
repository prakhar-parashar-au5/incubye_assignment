"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

type CopyStatus = "idle" | "copied" | "failed";

export function CopyPasswordButton({ value }: { value: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {status === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {status === "copied" ? "Copied" : "Copy password"}
      </Button>
      <span role="status" className="sr-only">
        {status === "copied" ? "Password copied" : status === "failed" ? "Copy failed. Select the password and copy it." : ""}
      </span>
      {status === "failed" ? (
        <span aria-hidden="true" className="text-[0.8125rem] text-muted-foreground">
          Select and copy it instead.
        </span>
      ) : null}
    </span>
  );
}

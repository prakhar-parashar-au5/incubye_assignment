"use client";

import Link from "next/link";
import { createContext, useContext, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";

import { RecordLine } from "@/components/ai-monitoring/monitoring-ui";
import { Button } from "@/components/ui/button";
import { TRACES_HREF, formatNumber } from "@/lib/ai-monitoring";
import { deleteTrace, type AdminErrorCode, type DeleteResult } from "@/server/actions/ai-monitoring";

// Controlled deletion of one trace. An inline confirmation (never a modal) shows the trace time, HR
// user, status, and what will be removed. Success is shown only from the backend's confirmation of
// this trace, and replaces the whole detail; nothing is put in the URL to claim a deletion, so a
// reload shows the not-found page.

type Deleted = Extract<DeleteResult, { ok: true }>["deleted"];
const DeletedContext = createContext<(deleted: Deleted) => void>(() => {});

export function DeletionFrame({ startedAt, hrUser, children }: { startedAt: string; hrUser: string; children: ReactNode }) {
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  if (deleted) {
    return (
      <section aria-labelledby="deleted-heading" className="mt-6 flex max-w-2xl items-start gap-2.5 rounded-md border border-[#b9dcc8] bg-[#eef7f1] px-3.5 py-3 text-sm">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-current" />
        <div className="flex flex-col gap-2">
          <h2 id="deleted-heading" ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
            Trace deleted
          </h2>
          <p>
            The turn started {startedAt} by {hrUser} was removed: {formatNumber(deleted.messages)} messages, {formatNumber(deleted.modelCalls)} model calls, {formatNumber(deleted.toolCalls)} tool calls
            {deleted.review ? ", and its review" : ""}. Other turns in the conversation are kept.
          </p>
          <p>
            <Link href={TRACES_HREF} className="font-medium text-primary underline underline-offset-4">
              Back to AI traces
            </Link>
          </p>
        </div>
      </section>
    );
  }
  return (
    <DeletedContext.Provider
      value={(value) => {
        setDeleted(value);
        requestAnimationFrame(() => headingRef.current?.focus());
      }}
    >
      {children}
    </DeletedContext.Provider>
  );
}

const ERROR_TEXT: Partial<Record<AdminErrorCode, string>> = {
  NOT_FOUND: "This trace was already deleted or does not exist.",
  FORBIDDEN: "Your HR role cannot delete traces.",
  SESSION_EXPIRED: "Your session has ended. Sign in again.",
};

export function DeletePanel({
  traceId,
  startedAt,
  hrUser,
  status,
  modelCalls,
  toolCalls,
  hasReview,
}: {
  traceId: string;
  startedAt: string;
  hrUser: string;
  status: string;
  modelCalls: number;
  toolCalls: number;
  hasReview: boolean;
}) {
  const onDeleted = useContext(DeletedContext);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<AdminErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const openerRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const id = useId();

  function begin() {
    setOpen(true);
    setError(null);
    requestAnimationFrame(() => questionRef.current?.focus());
  }

  function back() {
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  function confirm() {
    startTransition(async () => {
      let result: DeleteResult;
      try {
        result = await deleteTrace(traceId);
      } catch {
        result = { ok: false, error: "UNAVAILABLE" };
      }
      if (result.ok) {
        onDeleted(result.deleted);
        return;
      }
      setError(result.error);
      requestAnimationFrame(() => errorRef.current?.focus());
    });
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="text-[0.9375rem] font-semibold">
        Delete
      </h2>
      {!open ? (
        <Button ref={openerRef} type="button" variant="outline" className="h-10 w-fit border-[#e3b3ae] text-destructive hover:bg-[#fcf1f0] sm:h-9" onClick={begin}>
          Delete this trace…
        </Button>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3.5 py-3 text-sm">
          <h3 ref={questionRef} tabIndex={-1} className="font-semibold text-[#7d1a14] outline-none">
            Delete this trace permanently?
          </h3>
          <RecordLine
            className="border-[#e3b3ae]"
            items={[
              { label: "Started", value: startedAt },
              { label: "HR user", value: hrUser },
              { label: "Status", value: status },
            ]}
          />
          <p>
            This removes this turn&apos;s user message and answer, its {formatNumber(modelCalls)} model calls and {formatNumber(toolCalls)} tool calls{hasReview ? ", and its review" : ""}. Other
            turns in this conversation are kept. This cannot be undone.
          </p>
          {error ? (
            <p ref={errorRef} tabIndex={-1} role="alert" className="flex items-start gap-2 text-[#7d1a14] outline-none">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {ERROR_TEXT[error] ?? "The trace could not be deleted. It is unchanged. Try again."}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" onClick={confirm} disabled={pending || error === "NOT_FOUND"}>
              {pending ? "Deleting…" : "Delete trace"}
            </Button>
            <Button type="button" variant="outline" onClick={back} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

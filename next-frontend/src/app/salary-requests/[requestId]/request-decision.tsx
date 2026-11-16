"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NOTE_MAX_LENGTH } from "@/lib/salary";
import { failureCopy, type FailureCopy } from "@/lib/salary-messages";
import { approveSalaryRequest, cancelSalaryRequest } from "@/server/actions/salary";

// Admin decision controls for one pending request. Approve and cancel each take one explicit
// confirmation step inline (no modal). The request cannot be edited: Admin approves the exact
// request or cancels it with a note.

type Step = "idle" | "approve" | "cancel";

export function RequestDecision({ requestId, nextVersion, behind }: { requestId: string; nextVersion: number; behind: boolean }) {
  const router = useRouter();
  const id = useId();
  const [step, setStep] = useState<Step>("idle");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureCopy | null>(null);
  const [pending, startTransition] = useTransition();
  const key = useRef<{ action: Step; value: string } | null>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmText = useRef<HTMLParagraphElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // Focus requests are kept in a ref and applied after the render that shows the target.
  const pendingFocus = useRef<"approve" | "cancel" | "confirm" | "note" | "alert" | null>(null);
  const setFocusAfter = (target: "approve" | "cancel" | "confirm" | "note" | "alert") => {
    pendingFocus.current = target;
  };

  useLayoutEffect(() => {
    return () => {
      setStep("idle");
      setNote("");
      setFailure(null);
      key.current = null;
    };
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === "approve") approveButton.current?.focus();
    if (target === "cancel") cancelButton.current?.focus();
    if (target === "confirm") confirmText.current?.focus();
    if (target === "note") noteField.current?.focus();
    if (target === "alert") alertRef.current?.focus();
  });

  function keyFor(action: Step) {
    // Reused only when retrying the same action; a different action gets a new key.
    if (key.current?.action !== action) key.current = { action, value: crypto.randomUUID() };
    return key.current.value;
  }

  function open(next: Step) {
    setFailure(null);
    setStep(next);
    setFocusAfter(next === "approve" ? "confirm" : "note");
  }

  function back() {
    const from = step;
    setStep("idle");
    setNoteError(null);
    setFocusAfter(from === "cancel" ? "cancel" : "approve");
  }

  function settle(outcome: Awaited<ReturnType<typeof approveSalaryRequest>>) {
    if (outcome.ok) {
      key.current = null;
      setStep("idle");
      // Re-render the server page from the persisted request. No completion flag goes in the URL:
      // the page describes the recorded outcome the same way for every visitor.
      router.refresh();
      return;
    }
    const copy = failureCopy(outcome.kind, outcome.reason, "confirm");
    if (outcome.kind === "STALE_VERSION" || outcome.kind === "EMPLOYEE_INELIGIBLE" || outcome.kind === "REQUEST_NOT_PENDING") {
      // The backend has already recorded the outcome (stale, or decided by someone else); show it.
      key.current = null;
      setStep("idle");
      setFailure(
        outcome.kind === "REQUEST_NOT_PENDING"
          ? copy
          : {
              title: "This request can no longer be approved",
              body: "It is out of date because the employee's compensation or eligibility changed. Nothing was applied. The requester can submit a new request.",
            },
      );
      router.refresh();
    } else {
      setFailure(copy);
    }
    setFocusAfter("alert");
  }

  function approve() {
    const idempotencyKey = keyFor("approve");
    setFailure(null);
    startTransition(async () => settle(await approveSalaryRequest(requestId, idempotencyKey)));
  }

  function cancel() {
    const text = note.trim();
    if (text.length === 0) {
      setNoteError("Enter a reason for cancelling. The requester will see it.");
      setFocusAfter("note");
      return;
    }
    if (text.length > NOTE_MAX_LENGTH) {
      setNoteError("Shorten the reason to 2,000 characters.");
      setFocusAfter("note");
      return;
    }
    const idempotencyKey = keyFor("cancel");
    setFailure(null);
    startTransition(async () => settle(await cancelSalaryRequest(requestId, text, idempotencyKey)));
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-md border border-line bg-surface px-4 py-4">
      <h2 id={`${id}-heading`} className="text-[0.9375rem] font-semibold">
        Decision
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Approve this exact request or cancel it with a reason. Requests cannot be edited.</p>

      {failure ? (
        <div ref={alertRef} tabIndex={-1} role="alert" className="mt-3 flex items-start gap-2.5 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3.5 py-3 text-sm text-[#7d1a14]">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-2">
            <p className="font-semibold">{failure.title}</p>
            <p>{failure.body}</p>
            {failure.retry ? (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={step === "cancel" ? cancel : approve} disabled={pending}>
                Try again
              </Button>
            ) : null}
            {failure.signIn ? (
              <a href="/session/expired" className="font-medium underline underline-offset-4">
                Sign in again
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === "idle" ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button ref={approveButton} type="button" size="lg" onClick={() => open("approve")} disabled={pending}>
            Approve request
          </Button>
          <Button ref={cancelButton} type="button" variant="outline" size="lg" onClick={() => open("cancel")} disabled={pending}>
            Cancel request
          </Button>
        </div>
      ) : null}

      {step === "approve" ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
          <p ref={confirmText} tabIndex={-1} className="text-sm font-medium">
            Approve this exact change? Compensation version {nextVersion} will be created with the requested values.
            {behind ? " Compensation has changed since the request was made, so approval will be refused and the request marked out of date." : ""}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" size="lg" onClick={approve} disabled={pending}>
              {pending ? "Approving…" : "Confirm approval"}
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={back} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {step === "cancel" ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-note`}>Reason for cancelling</Label>
            <textarea
              ref={noteField}
              id={`${id}-note`}
              rows={3}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setNoteError(null);
              }}
              aria-invalid={noteError ? true : undefined}
              aria-describedby={`${id}-note-hint${noteError ? ` ${id}-note-error` : ""}`}
              className="w-full resize-y rounded-md border border-input bg-surface px-3 py-2 text-base text-foreground focus-visible:border-ring aria-invalid:border-destructive md:text-sm"
            />
            <p id={`${id}-note-hint`} className="text-[0.8125rem] text-muted-foreground">
              Required. Compensation will not change. Do not include sensitive personal details.
            </p>
            {noteError ? (
              <p id={`${id}-note-error`} className="text-[0.8125rem] text-destructive">
                {noteError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="destructive" size="lg" onClick={cancel} disabled={pending}>
              {pending ? "Cancelling…" : "Confirm cancellation"}
            </Button>
            <Button type="button" variant="ghost" size="lg" onClick={back} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? (step === "cancel" ? "Cancelling…" : "Approving…") : ""}
      </p>
    </section>
  );
}

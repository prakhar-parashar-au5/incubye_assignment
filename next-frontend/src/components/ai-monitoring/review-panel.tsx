"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MAX_REVIEW_NOTE, VERDICTS, VERDICT_LABELS, type TraceReview, type Verdict } from "@/lib/ai-monitoring";
import { formatDateTime } from "@/lib/format";
import { saveTraceReview, type AdminErrorCode } from "@/server/actions/ai-monitoring";

// One current review per trace. The form sends the version it was loaded with; if another Admin
// saved first, the backend answers 409 STALE_VERSION and this panel shows their review beside the
// kept draft. Nothing is saved again until the user chooses "Replace with my review".

type Notice =
  | { kind: "saved"; review: TraceReview }
  | { kind: "stale"; current: TraceReview | null | undefined }
  | { kind: "error"; error: AdminErrorCode };

const ERROR_TEXT: Partial<Record<AdminErrorCode, string>> = {
  NOT_FOUND: "This trace was deleted. The review was not saved.",
  IN_PROGRESS: "This turn has not finished. Reviews open when it does.",
  FORBIDDEN: "Your HR role cannot review traces.",
  INVALID: "Choose a verdict and keep the note to 2,000 characters.",
  SESSION_EXPIRED: "Your session has ended. Sign in again; your draft is not saved.",
};

function ReviewRecord({ review }: { review: TraceReview }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3 text-[0.8125rem]">
      <p>
        <span className="font-semibold">{VERDICT_LABELS[review.verdict]}</span> · reviewed by {review.reviewer.displayName} · updated {formatDateTime(review.updatedAt)}
      </p>
      {review.note ? <p className="break-words whitespace-pre-wrap">{review.note}</p> : <p className="text-muted-foreground">No note.</p>}
      {review.nominated ? <p>Nominated as an evaluation-fixture candidate.</p> : null}
    </div>
  );
}

export function ReviewPanel({ traceId, review, inProgress }: { traceId: string; review: TraceReview | null; inProgress: boolean }) {
  const [verdict, setVerdict] = useState<Verdict | null>(review?.verdict ?? null);
  const [note, setNote] = useState(review?.note ?? "");
  const [nominated, setNominated] = useState(review?.nominated ?? false);
  const [version, setVersion] = useState(review?.version ?? 0);
  const [current, setCurrent] = useState<TraceReview | null>(review);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();
  const noticeRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const tooLong = note.length > MAX_REVIEW_NOTE;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verdict || tooLong || pending) return;
    startTransition(async () => {
      let next: Notice;
      try {
        const result = await saveTraceReview({ traceId, verdict, note, nominated, expectedVersion: version });
        if (result.ok) {
          next = { kind: "saved", review: result.review };
          setCurrent(result.review);
          setVersion(result.review.version);
        } else if (result.error === "STALE") {
          next = { kind: "stale", current: result.current };
          if (result.current) {
            setCurrent(result.current);
            setVersion(result.current.version);
          }
        } else {
          next = { kind: "error", error: result.error };
        }
      } catch {
        next = { kind: "error", error: "UNAVAILABLE" };
      }
      setNotice(next);
      requestAnimationFrame(() => noticeRef.current?.focus());
    });
  }

  const stale = notice?.kind === "stale";
  const label = stale ? "Replace with my review" : current ? "Replace review" : "Save review";

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} tabIndex={-1} className="text-[0.9375rem] font-semibold outline-none">
        Review
      </h2>
      {current ? <ReviewRecord review={current} /> : <p className="border-t border-line pt-3 text-[0.8125rem] text-muted-foreground">Not reviewed yet.</p>}

      {notice ? (
        <div ref={noticeRef} tabIndex={-1} role={notice.kind === "saved" ? "status" : "alert"} className="outline-none">
          {notice.kind === "saved" ? (
            <p className="flex items-start gap-2 rounded-md border border-[#b9dcc8] bg-[#eef7f1] px-3 py-2 text-[0.8125rem]">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-current" />
              <span>Review saved: {VERDICT_LABELS[notice.review.verdict]}.</span>
            </p>
          ) : notice.kind === "stale" ? (
            <div className="flex items-start gap-2 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3 py-2 text-[0.8125rem]">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-upcoming" />
              <div className="flex flex-col gap-1">
                <p className="font-medium">Another review was saved while you were editing.</p>
                <p>
                  {notice.current
                    ? `The saved review above is now ${VERDICT_LABELS[notice.current.verdict]} by ${notice.current.reviewer.displayName}. Your verdict and note are kept below; nothing was saved.`
                    : "Reload the trace to see the saved review. Your verdict and note are kept below; nothing was saved."}
                </p>
              </div>
            </div>
          ) : (
            <p className="flex items-start gap-2 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3 py-2 text-[0.8125rem] text-[#7d1a14]">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{ERROR_TEXT[notice.error] ?? "The review could not be saved. Try again."}</span>
            </p>
          )}
        </div>
      ) : null}

      {inProgress ? (
        <p className="text-[0.8125rem] text-muted-foreground">Reviews open when the turn finishes.</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">Verdict</legend>
            {VERDICTS.map((value) => (
              <label key={value} className="flex min-h-10 items-center gap-2 text-sm sm:min-h-8">
                <input type="radio" name={`${id}-verdict`} value={value} checked={verdict === value} onChange={() => setVerdict(value)} className="size-4 accent-[#2a57c0]" />
                {VERDICT_LABELS[value]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-note`}>Note (optional)</Label>
            <textarea
              id={`${id}-note`}
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby={`${id}-count`}
              aria-invalid={tooLong || undefined}
              className="w-full resize-y rounded-md border border-input bg-surface px-3 py-2 text-base focus-visible:border-ring aria-invalid:border-destructive md:text-sm"
            />
            <p id={`${id}-count`} className={tooLong ? "text-[0.75rem] text-destructive" : "text-[0.75rem] text-muted-foreground"}>
              {note.length.toLocaleString("en-US")} of 2,000 characters{tooLong ? ". Shorten the note to save." : ""}
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={nominated} onChange={(event) => setNominated(event.target.checked)} aria-describedby={`${id}-nominate`} className="mt-0.5 size-4 accent-[#2a57c0]" />
            <span>
              Nominate as an evaluation-fixture candidate
              <span id={`${id}-nominate`} className="block text-[0.75rem] text-muted-foreground">
                A developer still inspects and redacts it by hand. Nothing is copied automatically.
              </span>
            </span>
          </label>
          <Button type="submit" className="h-10 w-fit sm:h-9" disabled={!verdict || tooLong || pending}>
            {pending ? "Saving…" : label}
          </Button>
        </form>
      )}
    </section>
  );
}

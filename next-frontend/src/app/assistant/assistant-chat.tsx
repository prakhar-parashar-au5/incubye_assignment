"use client";

import { useId, useLayoutEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, CornerDownLeft, EyeOff, TriangleAlert } from "lucide-react";

import { AssistantCardView } from "@/components/assistant/assistant-cards";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MAX_MESSAGE_LENGTH, SUGGESTED_PROMPTS, failedTurnText, toolLabel, type ThreadItem } from "@/lib/assistant";
import { formatDateTime } from "@/lib/format";
import { sendConversationMessage, type SendErrorCode, type SendResult } from "@/server/actions/assistant";

// One saved conversation (or a new one) and its composer. The thread comes from the server: the
// page renders it from the backend's saved conversation, and every send re-renders it from there.
// This component holds only what the server cannot know yet: the message being sent, a send whose
// outcome is unknown, the draft, and the idempotency key for the submission in flight. None of it is
// written to localStorage, sessionStorage, IndexedDB, cookies, or the URL.
//
// Two different retries:
// - "Send again" re-sends the same submission with the SAME key, used only when the outcome is
//   unknown. The backend returns the stored result instead of running the turn twice.
// - "Retry" on a recorded failed turn sends that message as a NEW turn with a NEW key and
//   retryOfTraceId. The failed turn stays in the history.
//
// With Cache Components, Next.js keeps a route mounted but hidden (React <Activity>) after a
// client-side navigation. A layout-effect cleanup runs when the route is hidden; it clears the
// draft and pending send and invalidates any request still in flight.

type Submission = { content: string; key: string; retryOfTraceId?: string; fromDraft: boolean };
type Pending = Submission & { state: "sending" | "unconfirmed" };
type Notice = { error: Exclude<SendErrorCode, "RECORDED_FAILURE" | "IN_PROGRESS" | "UNCONFIRMED">; retryAfterSeconds?: number };

const NOTICE_TEXT: Record<Notice["error"], { title: string; body: string }> = {
  SESSION_EXPIRED: { title: "Your session has ended", body: "Sign in again to keep using the assistant." },
  INVALID_MESSAGE: { title: "The assistant could not accept this message", body: "Messages must be 1 to 2,000 characters." },
  CONVERSATION_NOT_FOUND: { title: "This conversation is no longer available", body: "It may have been removed. Start a new conversation." },
  RATE_LIMITED: { title: "Too many assistant requests", body: "The assistant allows 20 requests in 15 minutes. Wait and try again later." },
  DUPLICATE_OPERATION: { title: "This message conflicts with an earlier send", body: "Reload the conversation to see what was recorded." },
  STORAGE_UNAVAILABLE: {
    title: "The assistant is unavailable",
    body: "Nothing was answered, and your message may not have been saved. The employee directory still works.",
  },
};

function newKey(): string {
  return crypto.randomUUID();
}

function rateLimitBody(seconds: number | undefined): string {
  if (seconds === undefined) return NOTICE_TEXT.RATE_LIMITED.body;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `The assistant allows 20 requests in 15 minutes. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-[#efece6] px-3.5 py-2.5">
      <p className="text-[0.75rem] font-semibold text-muted-foreground">You</p>
      <p className="text-[0.9375rem] break-words whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function AnswerView({ item }: { item: Extract<ThreadItem, { kind: "answer" }> }) {
  const { response } = item;
  return (
    <article className="flex flex-col gap-3" aria-label="Assistant answer">
      <p className="text-[0.75rem] font-semibold text-muted-foreground">Assistant</p>
      {/* Model text is shown as plain text: React escapes it, and no HTML or Markdown is rendered. */}
      <p className="text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap">{item.text}</p>
      {response.toolCalls.length > 0 ? (
        <div className="border-t border-line pt-2">
          <p className="text-[0.75rem] font-semibold text-muted-foreground">Tool activity</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-[0.8125rem]">
            {response.toolCalls.map((call, index) => (
              <li key={`${call.name}-${index}`} className="flex flex-wrap gap-x-2">
                <span>{toolLabel(call.name)}</span>
                <span className={call.status === "completed" ? "text-state-current" : "text-destructive"}>
                  {call.status === "completed" ? "completed" : call.status === "rejected" ? "rejected (not run)" : "failed"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {response.cards.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-[0.75rem] text-muted-foreground">Figures below come from the directory tools, within your access. The text above is model-written.</p>
          {response.cards.map((card, index) => (
            <AssistantCardView key={index} card={card} />
          ))}
        </div>
      ) : null}
      {item.rowsDropped ? <p className="text-[0.8125rem] text-muted-foreground">Some results outside your access were not shown.</p> : null}
      {response.limitations.length > 0 ? (
        <div className="rounded-md border border-line bg-muted/60 px-3 py-2">
          <p className="text-[0.75rem] font-semibold text-muted-foreground">Limitations</p>
          <ul className="mt-1 list-disc pl-5 text-[0.8125rem]">
            {response.limitations.map((limitation, index) => (
              <li key={index}>{limitation}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[0.75rem] text-muted-foreground">
        Answered <time dateTime={response.generatedAt}>{formatDateTime(response.generatedAt)}</time>
      </p>
    </article>
  );
}

function WithheldView({ text }: { text: string }) {
  return (
    <article className="flex flex-col gap-2" aria-label="Assistant answer withheld">
      <p className="text-[0.75rem] font-semibold text-muted-foreground">Assistant</p>
      <p className="flex items-start gap-2 rounded-md border border-line bg-muted/60 px-3 py-2 text-[0.875rem]">
        <EyeOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="break-words">{text}</span>
      </p>
    </article>
  );
}

function FailedTurn({ item, onRetry, disabled }: { item: Extract<ThreadItem, { kind: "failed" }>; onRetry: (content: string, traceId: string) => void; disabled: boolean }) {
  const text = failedTurnText(item.error);
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3.5 py-3 text-sm text-[#7d1a14]">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-2">
        <p className="font-medium">{text.title}</p>
        <p>{text.body}</p>
        {item.retryText !== null ? (
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => onRetry(item.retryText!, item.traceId)} disabled={disabled}>
            Retry
          </Button>
        ) : (
          <p className="text-[0.8125rem]">Retried below.</p>
        )}
      </div>
    </div>
  );
}

function InProgress({ checkHref }: { checkHref: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>Still working on this message.</span>
      {/* A full page load, so the backend is asked again. */}
      <a href={checkHref} className="font-medium text-primary underline underline-offset-4">
        Check again
      </a>
    </p>
  );
}

export function AssistantChat({ conversationId, items }: { conversationId: string | null; items: readonly ThreadItem[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // A conversation created by an earlier send from /assistant that did not get a recorded turn
  // (for example a rate limit). The next send reuses it instead of creating another empty one.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  // Incremented when the route is hidden; a result for an older generation is dropped.
  const generation = useRef(0);
  const inputId = useId();
  const pageHref = conversationId ? `/assistant/${conversationId}` : "/assistant";

  useLayoutEffect(() => {
    return () => {
      generation.current += 1;
      setDraft("");
      setPending(null);
      setNotice(null);
    };
  }, []);

  function settle(result: SendResult, submission: Submission) {
    const target = result.conversationId;
    const leaveForConversation = conversationId === null && target !== null;
    if (result.ok || result.error === "RECORDED_FAILURE" || result.error === "IN_PROGRESS") {
      // The outcome is part of the saved thread: show it from the server.
      if (leaveForConversation) router.replace(`/assistant/${target}`);
      setPending(null);
      return;
    }
    if (result.error === "UNCONFIRMED") {
      if (conversationId === null && target) setCreatedId(target);
      setPending({ ...submission, state: "unconfirmed" });
      return;
    }
    if (conversationId === null && target) setCreatedId(target);
    setPending(null);
    setNotice({ error: result.error, retryAfterSeconds: result.retryAfterSeconds });
    if (submission.fromDraft && result.error !== "SESSION_EXPIRED" && result.error !== "CONVERSATION_NOT_FOUND") setDraft(submission.content);
  }

  function run(submission: Submission) {
    const started = generation.current;
    setNotice(null);
    setPending({ ...submission, state: "sending" });
    startTransition(async () => {
      let result: SendResult;
      try {
        result = await sendConversationMessage({
          conversationId: conversationId ?? createdId,
          content: submission.content,
          idempotencyKey: submission.key,
          ...(submission.retryOfTraceId ? { retryOfTraceId: submission.retryOfTraceId } : {}),
        });
      } catch {
        // The request to this app failed: the message may or may not have reached the backend.
        result = { ok: false, error: "UNCONFIRMED", conversationId: null };
      }
      if (generation.current !== started) return;
      startTransition(() => settle(result, submission));
    });
  }

  const sending = busy || pending !== null;

  function send(text: string) {
    const content = text.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH || sending) return;
    setDraft("");
    run({ content, key: newKey(), fromDraft: true });
  }

  function retry(content: string, traceId: string) {
    if (sending) return;
    run({ content, key: newKey(), retryOfTraceId: traceId, fromDraft: false });
  }

  function sendAgain() {
    if (!pending || busy) return;
    // Same key, same content: the backend replays the stored result if it got the first send.
    run({ content: pending.content, key: pending.key, retryOfTraceId: pending.retryOfTraceId, fromDraft: pending.fromDraft });
  }

  function discard() {
    if (!pending) return;
    if (pending.fromDraft && draft === "") setDraft(pending.content);
    setPending(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  }

  const tooLong = draft.length > MAX_MESSAGE_LENGTH;
  const empty = items.length === 0 && pending === null;
  const noticeText = notice ? (notice.error === "RATE_LIMITED" ? { ...NOTICE_TEXT.RATE_LIMITED, body: rateLimitBody(notice.retryAfterSeconds) } : NOTICE_TEXT[notice.error]) : null;

  return (
    <div className="flex flex-col gap-6">
      {empty ? (
        <section aria-labelledby="suggestions-heading">
          <h2 id="suggestions-heading" className="text-[0.9375rem] font-semibold">
            Try a question
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {SUGGESTED_PROMPTS.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  onClick={() => send(item.prompt)}
                  disabled={sending}
                  className="flex h-full min-h-10 w-full flex-col items-start gap-0.5 rounded-md border border-line bg-surface px-3.5 py-3 text-left transition-[border-color,background-color] duration-150 hover:border-input hover:bg-[#faf9f6] disabled:opacity-50"
                >
                  <span className="text-[0.75rem] font-semibold text-muted-foreground">{item.label}</span>
                  <span className="text-sm">{item.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <ol className="flex flex-col gap-6" aria-label="Conversation">
          {items.map((item) => (
            <li key={item.key}>
              {item.kind === "user" ? (
                <UserMessage text={item.text} />
              ) : item.kind === "answer" ? (
                <AnswerView item={item} />
              ) : item.kind === "withheld" ? (
                <WithheldView text={item.text} />
              ) : item.kind === "failed" ? (
                <FailedTurn item={item} onRetry={retry} disabled={sending} />
              ) : item.kind === "in-progress" ? (
                <InProgress checkHref={pageHref} />
              ) : (
                <p className="border-y border-line py-2 text-center text-[0.8125rem] text-muted-foreground">Earlier messages in this conversation were removed.</p>
              )}
            </li>
          ))}
          {pending ? (
            <li key="pending" className="flex flex-col gap-3">
              <UserMessage text={pending.content} />
              {pending.state === "sending" ? (
                <p className="text-sm text-muted-foreground">Sending…</p>
              ) : (
                <div className="flex items-start gap-2.5 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3.5 py-3 text-sm">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-upcoming" />
                  <div className="flex flex-col gap-2">
                    <p className="font-medium">This message may not have been received</p>
                    <p>The compensation service did not confirm it. Sending again is safe: a message that already arrived is not answered twice.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={sendAgain} disabled={busy}>
                        Send again
                      </Button>
                      <Button type="button" variant="link" size="sm" onClick={discard} disabled={busy}>
                        Discard
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </li>
          ) : null}
        </ol>
      )}

      <p role="status" aria-live="polite" className={pending?.state === "sending" ? "text-sm text-muted-foreground" : "sr-only"}>
        {pending?.state === "sending" ? "The assistant is working. This can take up to 45 seconds…" : ""}
      </p>

      {notice && noticeText ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3.5 py-3 text-sm text-[#7d1a14]">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-2">
            <p className="font-medium">{noticeText.title}</p>
            <p>{noticeText.body}</p>
            {notice.error === "SESSION_EXPIRED" ? (
              <a href="/session/expired" className="font-medium underline underline-offset-4">
                Sign in again
              </a>
            ) : notice.error === "CONVERSATION_NOT_FOUND" ? (
              <Link href="/assistant" className="font-medium underline underline-offset-4">
                Start a new conversation
              </Link>
            ) : notice.error === "DUPLICATE_OPERATION" ? (
              <a href={pageHref} className="font-medium underline underline-offset-4">
                Reload the conversation
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line pt-4">
        <Label htmlFor={inputId}>Ask about employees and compensation</Label>
        <textarea
          id={inputId}
          name="message"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby={`${inputId}-hint`}
          aria-invalid={tooLong || undefined}
          autoComplete="off"
          className="w-full resize-y rounded-md border border-input bg-surface px-3 py-2 text-base text-foreground transition-[border-color] duration-150 focus-visible:border-ring aria-invalid:border-destructive md:text-sm"
          placeholder="For example: what is the average annual base salary in Tech…"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p id={`${inputId}-hint`} className={tooLong ? "text-[0.8125rem] text-destructive" : "text-[0.8125rem] text-muted-foreground"}>
            {tooLong
              ? `${draft.length.toLocaleString("en-US")} of 2,000 characters. Shorten the message to send it.`
              : "Enter to send, Shift+Enter for a new line. Read-only: the assistant cannot change records. It considers your recent messages, not the whole conversation."}
          </p>
          <Button type="submit" className="h-10 sm:h-9" disabled={sending || tooLong || draft.trim().length === 0}>
            <CornerDownLeft aria-hidden="true" />
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}

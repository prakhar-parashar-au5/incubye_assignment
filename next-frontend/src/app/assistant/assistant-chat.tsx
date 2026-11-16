"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { CircleAlert, CornerDownLeft } from "lucide-react";

import { AssistantCardView } from "@/components/assistant/assistant-cards";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MAX_MESSAGE_LENGTH, SUGGESTED_PROMPTS, toolLabel, type AssistantReply, type ChatMessage } from "@/lib/assistant";
import { askAssistant, type AssistantErrorCode } from "@/server/actions/assistant";

// The conversation lives in this component's memory only. It is never written to localStorage,
// sessionStorage, IndexedDB, cookies, or the URL, and it is cleared when the page is left.
//
// With Cache Components, Next.js keeps a route mounted but hidden (React <Activity>) after a
// client-side navigation, so state would survive leaving and returning. A layout-effect cleanup
// runs when the route is hidden; it clears the conversation and invalidates any request still in
// flight, so a late answer cannot reappear.

type Turn =
  | { id: number; role: "user"; content: string }
  | { id: number; role: "assistant"; content: string; reply: AssistantReply; withheld: boolean }
  | { id: number; role: "error"; error: AssistantErrorCode };

const ERROR_TEXT: Record<AssistantErrorCode, { title: string; body: string }> = {
  SESSION_EXPIRED: { title: "Your session has ended", body: "Sign in again to keep using the assistant." },
  INVALID_CONVERSATION: { title: "The assistant could not accept this conversation", body: "Messages must be 1 to 2,000 characters. Start a new conversation if it has grown long." },
  ASSISTANT_UNAVAILABLE: { title: "The assistant is unavailable", body: "The language model did not answer or is not configured. The employee directory still works." },
  TIMEOUT: { title: "The assistant took too long to answer", body: "Try again, or ask a narrower question." },
  RATE_LIMITED: { title: "Too many assistant requests", body: "The assistant has a request limit. Wait and try again later." },
  SERVICE_UNAVAILABLE: { title: "The compensation service is not responding", body: "Try again in a moment." },
  INVALID_RESPONSE: { title: "The assistant sent a response this page cannot read", body: "Nothing from it is shown. Try again." },
};

const timeFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

function history(turns: readonly Turn[]): ChatMessage[] {
  return turns.flatMap((turn): ChatMessage[] =>
    turn.role === "error" ? [] : [{ role: turn.role, content: turn.content }],
  );
}

function AssistantTurn({ turn }: { turn: Extract<Turn, { role: "assistant" }> }) {
  const { reply } = turn;
  return (
    <article className="flex flex-col gap-3" aria-label="Assistant answer">
      <p className="text-[0.75rem] font-semibold text-muted-foreground">Assistant</p>
      {/* Model text is shown as plain text: React escapes it, and no HTML or Markdown is rendered. */}
      <p className="text-[0.9375rem] leading-relaxed whitespace-pre-wrap">{reply.answer}</p>
      {reply.toolCalls.length > 0 ? (
        <div className="border-t border-line pt-2">
          <p className="text-[0.75rem] font-semibold text-muted-foreground">Tool activity</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-[0.8125rem]">
            {reply.toolCalls.map((call, index) => (
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
      {reply.cards.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-[0.75rem] text-muted-foreground">Figures below come from the directory tools, within your access. The text above is model-written.</p>
          {reply.cards.map((card, index) => (
            <AssistantCardView key={index} card={card} />
          ))}
        </div>
      ) : null}
      {turn.withheld ? (
        <p className="text-[0.8125rem] text-muted-foreground">Some results outside your access were not shown.</p>
      ) : null}
      {reply.limitations.length > 0 ? (
        <div className="rounded-md border border-line bg-muted/60 px-3 py-2">
          <p className="text-[0.75rem] font-semibold text-muted-foreground">Limitations</p>
          <ul className="mt-1 list-disc pl-5 text-[0.8125rem]">
            {reply.limitations.map((limitation, index) => (
              <li key={index}>{limitation}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[0.75rem] text-muted-foreground">
        Answered <time dateTime={reply.generatedAt}>{timeFormatter.format(new Date(reply.generatedAt))}</time>
      </p>
    </article>
  );
}

function ErrorTurn({ error, onRetry, retryDisabled }: { error: AssistantErrorCode; onRetry: () => void; retryDisabled: boolean }) {
  const text = ERROR_TEXT[error];
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3.5 py-3 text-sm text-[#7d1a14]">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-2">
        <p className="font-medium">{text.title}</p>
        <p>{text.body}</p>
        {error === "SESSION_EXPIRED" ? (
          <a href="/session/expired" className="font-medium underline underline-offset-4">
            Sign in again
          </a>
        ) : error === "INVALID_CONVERSATION" ? null : (
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onRetry} disabled={retryDisabled}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

export function AssistantChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const nextId = useRef(1);
  // Incremented whenever the conversation is cleared; a reply for an older generation is dropped.
  const generation = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns, pending]);

  useLayoutEffect(() => {
    return () => {
      generation.current += 1;
      setTurns([]);
      setDraft("");
    };
  }, []);

  function run(conversation: Turn[]) {
    const started = generation.current;
    startTransition(async () => {
      const result = await askAssistant(history(conversation));
      if (generation.current !== started) return;
      setTurns((current) => [
        ...current,
        result.ok
          ? { id: nextId.current++, role: "assistant", content: result.reply.answer, reply: result.reply, withheld: result.withheld }
          : { id: nextId.current++, role: "error", error: result.error },
      ]);
    });
  }

  function send(text: string) {
    const content = text.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH || pending) return;
    const conversation: Turn[] = [...turns.filter((turn) => turn.role !== "error"), { id: nextId.current++, role: "user", content }];
    setTurns(conversation);
    setDraft("");
    run(conversation);
  }

  function retry() {
    const conversation = turns.filter((turn) => turn.role !== "error");
    setTurns(conversation);
    run(conversation);
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

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {turns.length === 0 ? (
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
                  disabled={pending}
                  className="flex h-full w-full flex-col items-start gap-0.5 rounded-md border border-line bg-surface px-3.5 py-3 text-left transition-[border-color,background-color] duration-150 hover:border-input hover:bg-[#faf9f6] disabled:opacity-50"
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
          {turns.map((turn) => (
            <li key={turn.id}>
              {turn.role === "user" ? (
                <div className="flex flex-col gap-1 rounded-md bg-[#efece6] px-3.5 py-2.5">
                  <p className="text-[0.75rem] font-semibold text-muted-foreground">You</p>
                  <p className="text-[0.9375rem] whitespace-pre-wrap">{turn.content}</p>
                </div>
              ) : turn.role === "assistant" ? (
                <AssistantTurn turn={turn} />
              ) : (
                <ErrorTurn error={turn.error} onRetry={retry} retryDisabled={pending} />
              )}
            </li>
          ))}
        </ol>
      )}

      <p role="status" aria-live="polite" className={pending ? "text-sm text-muted-foreground" : "sr-only"}>
        {pending ? "The assistant is working. This can take up to 45 seconds…" : ""}
      </p>
      <div ref={endRef} />

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
              : "Enter to send, Shift+Enter for a new line. Read-only: the assistant cannot change records."}
          </p>
          <Button type="submit" disabled={pending || tooLong || draft.trim().length === 0}>
            <CornerDownLeft aria-hidden="true" />
            {pending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}

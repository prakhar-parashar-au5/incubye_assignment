import Link from "next/link";
import { ArrowLeft, CircleAlert, FlaskConical, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RECORDING_NOTICE, conversationLabel, type ConversationSummary } from "@/lib/assistant";
import { formatCount, formatDateTime } from "@/lib/format";
import type { ApiResult } from "@/server/api/client";
import type { AssistantConversationListResponse } from "@/server/api/contract";

// Server-rendered parts of the assistant pages: heading, recording notice, and the caller's own
// conversation list. Layout: at 1280px and wider the list sits in a left column beside the thread;
// narrower, /assistant shows the list below the composer and a conversation page links back to it.

export function AssistantHeading({ subtitle }: { subtitle?: string }) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em] text-balance">Compensation assistant</h1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">{subtitle ?? "Ask questions about the employees and compensation you can access"}</p>
    </div>
  );
}

/** Always visible in full, before the first message and on every conversation. Not dismissible. */
export function RecordingNotice({ scope }: { scope: string }) {
  return (
    <section
      aria-labelledby="recording-notice-heading"
      className="flex max-w-3xl items-start gap-2.5 rounded-md border border-[#c3d0ec] bg-accent px-3.5 py-3 text-sm"
    >
      <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex flex-col gap-1">
        <h2 id="recording-notice-heading" className="font-semibold">
          Recorded for quality review
        </h2>
        <p data-testid="recording-notice-text">{RECORDING_NOTICE}</p>
        <p className="text-muted-foreground">
          The assistant is read-only and answers within your access ({scope}). Its text is written by a language model; the figures in its cards come
          from the directory.
        </p>
      </div>
    </section>
  );
}

function rowLabel(summary: ConversationSummary): string {
  return conversationLabel(summary) ?? `Conversation started ${formatDateTime(summary.createdAt)}`;
}

function rowDetail(summary: ConversationSummary): string {
  const count = summary.messageCount === 0 ? "No messages yet" : `${formatCount(summary.messageCount)} ${summary.messageCount === 1 ? "message" : "messages"}`;
  return summary.lastMessageAt ? `${count} · last ${formatDateTime(summary.lastMessageAt)}` : count;
}

export function ConversationList({
  result,
  currentId,
  page,
  compact,
}: {
  result: ApiResult<AssistantConversationListResponse> | null;
  currentId: string | null;
  page: number;
  /** Beside an open conversation: page 1 only, with a link to older pages. */
  compact: boolean;
}) {
  const pageHref = (n: number) => (n <= 1 ? "/assistant" : `/assistant?page=${n}`);
  let body: ReactNode;
  if (!result || !result.ok) {
    body = (
      <Alert variant="destructive" className="mt-3">
        <CircleAlert aria-hidden="true" />
        <AlertTitle className="text-[#7d1a14]">Saved conversations could not be loaded</AlertTitle>
        <AlertDescription className="text-[#7d1a14]">
          <a href={currentId ? `/assistant/${currentId}` : pageHref(page)} className="font-medium">
            Try again
          </a>
        </AlertDescription>
      </Alert>
    );
  } else if (result.data.conversations.length === 0) {
    body = <p className="mt-3 text-sm text-muted-foreground">{page > 1 ? "No conversations on this page." : "No saved conversations yet. Conversations are kept for 30 days."}</p>;
  } else {
    const { conversations, page: info } = result.data;
    body = (
      <>
        <ol className="mt-3 flex flex-col border-t border-line">
          {conversations.map((summary) => {
            const current = summary.conversationId === currentId;
            return (
              <li key={summary.conversationId} className="border-b border-line">
                <Link
                  href={`/assistant/${summary.conversationId}`}
                  aria-current={current ? "page" : undefined}
                  className={
                    current
                      ? "-mx-2 my-1 flex min-h-10 flex-col gap-0.5 rounded-md border border-primary bg-accent px-2 py-2"
                      : "-mx-2 my-1 flex min-h-10 flex-col gap-0.5 rounded-md px-2 py-2 hover:bg-surface"
                  }
                >
                  <span className="text-sm font-medium break-words">{rowLabel(summary)}</span>
                  <span className="text-[0.75rem] text-muted-foreground">{rowDetail(summary)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        {compact ? (
          info.totalPages > 1 ? (
            <p className="mt-3 text-sm">
              <Link href={pageHref(2)} className="font-medium text-primary underline underline-offset-4">
                Older conversations
              </Link>
            </p>
          ) : null
        ) : info.totalPages > 1 ? (
          <nav aria-label="Conversation pages" className="mt-3 flex items-center justify-between gap-3 text-sm">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="font-medium text-primary underline underline-offset-4">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              Page {formatCount(page)} of {formatCount(info.totalPages)}
            </span>
            {page < info.totalPages ? (
              <Link href={pageHref(page + 1)} className="font-medium text-primary underline underline-offset-4">
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </>
    );
  }
  return (
    <nav aria-labelledby="conversations-heading" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="conversations-heading" className="text-[0.9375rem] font-semibold">
          Your conversations
        </h2>
        <Link
          href="/assistant"
          aria-current={currentId === null && page === 1 ? "page" : undefined}
          className={buttonVariants({ variant: "outline", size: "sm", className: "h-10 no-underline sm:h-8" })}
        >
          <Plus aria-hidden="true" />
          Start a new conversation
        </Link>
      </div>
      {body}
    </nav>
  );
}

export function AllConversationsLink() {
  return (
    <Link href="/assistant" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline xl:hidden">
      <ArrowLeft aria-hidden="true" className="size-4" />
      All conversations
    </Link>
  );
}

/**
 * The thread column comes first in the DOM (it is the page's task); at 1280px and wider the list is
 * placed in the left column. `listOnNarrow` decides whether the list also shows below the thread on
 * narrower screens (on /assistant) or only on wide screens (on a conversation page).
 */
export function WorkspaceLayout({ thread, list, listOnNarrow }: { thread: ReactNode; list: ReactNode; listOnNarrow: boolean }) {
  return (
    <div className="mt-8 grid gap-10 xl:grid-cols-[18rem_minmax(0,48rem)] xl:gap-12">
      <div className="min-w-0 max-w-3xl xl:col-start-2 xl:row-start-1">{thread}</div>
      <div className={listOnNarrow ? "min-w-0 xl:col-start-1 xl:row-start-1" : "hidden min-w-0 xl:col-start-1 xl:row-start-1 xl:block"}>{list}</div>
    </div>
  );
}

export function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div className="mt-8 grid gap-10 xl:grid-cols-[18rem_minmax(0,48rem)] xl:gap-12" aria-busy="true">
      <div className="flex flex-col gap-3 xl:col-start-2 xl:row-start-1">
        <p role="status" className="text-sm text-muted-foreground">
          {label}
        </p>
        <Skeleton aria-hidden="true" className="h-16 w-full animate-none bg-muted" />
        <Skeleton aria-hidden="true" className="h-24 w-full animate-none bg-muted" />
      </div>
      <div className="hidden flex-col gap-2 xl:col-start-1 xl:row-start-1 xl:flex" aria-hidden="true">
        <Skeleton className="h-5 w-40 animate-none bg-muted" />
        <Skeleton className="h-12 w-full animate-none bg-muted" />
        <Skeleton className="h-12 w-full animate-none bg-muted" />
      </div>
    </div>
  );
}

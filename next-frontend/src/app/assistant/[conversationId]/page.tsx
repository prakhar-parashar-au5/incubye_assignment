import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";

import {
  AllConversationsLink,
  AssistantHeading,
  ConversationList,
  RecordingNotice,
  WorkspaceLayout,
  WorkspaceSkeleton,
} from "@/components/assistant/conversation-workspace";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { CONVERSATION_PAGE_SIZE, buildThread, conversationLabel, isUuid } from "@/lib/assistant";
import { formatDateTime } from "@/lib/format";
import { scopeSummary } from "@/lib/hr-scope";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

import { AssistantChat } from "../assistant-chat";

// The title never includes conversation content.
export const metadata: Metadata = { title: "Conversation" };

export default function ConversationPage({ params }: PageProps<"/assistant/[conversationId]">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <AssistantHeading />
          <WorkspaceSkeleton label="Loading conversation…" />
        </AppShellSkeleton>
      }
    >
      <Conversation params={params} />
    </Suspense>
  );
}

async function Conversation({ params }: { params: PageProps<"/assistant/[conversationId]">["params"] }) {
  const [{ conversationId }, { session, token }] = await Promise.all([params, loadSessionAndToken()]);
  // Not a UUID: the same not-found page as an unknown or someone else's conversation.
  if (!isUuid(conversationId)) notFound();
  const client = api();
  const [detail, list] = await Promise.all([
    token ? client.getAssistantConversation(token, conversationId) : Promise.resolve(null),
    token ? client.listAssistantConversations(token, { page: 1, pageSize: CONVERSATION_PAGE_SIZE }) : Promise.resolve(null),
  ]);
  const user = requireUser(session);
  redirectIfUnauthenticated(detail && !detail.ok ? detail.kind : undefined, list && !list.ok ? list.kind : undefined);
  // Unknown and unowned conversations get the same backend 404, and the same page here.
  if (detail && !detail.ok && detail.kind === "NOT_FOUND") notFound();

  const retry = `/assistant/${conversationId}`;
  if (!user) {
    return (
      <AppShell identity={null} current="assistant">
        <AssistantHeading />
        <ServiceUnavailable retryHref={retry} />
      </AppShell>
    );
  }

  const shell = (children: ReactNode) => (
    <AppShell identity={identityOf(user)} current="assistant">
      <AllConversationsLink />
      <div className="mt-2 xl:mt-0">
        <AssistantHeading />
      </div>
      <div className="mt-5">
        <RecordingNotice scope={scopeSummary(user.role, user.countries, user.departments)} />
      </div>
      {children}
    </AppShell>
  );
  const listView = <ConversationList result={list} currentId={conversationId} page={1} compact />;

  if (!detail || !detail.ok) {
    const failure =
      detail?.kind === "INVALID_RESPONSE" ? (
        <UnexpectedResponse retryHref={retry} />
      ) : detail?.kind === "ASSISTANT_UNAVAILABLE" ? (
        <Alert variant="destructive" className="max-w-2xl">
          <CircleAlert aria-hidden="true" />
          <AlertTitle className="text-[#7d1a14]">Saved conversations are unavailable right now</AlertTitle>
          <AlertDescription className="text-[#7d1a14]">
            <p>The employee directory and other pages still work.</p>
            <p>
              <a href={retry} className={buttonVariants({ variant: "outline", size: "sm", className: "no-underline" })}>
                Try again
              </a>
            </p>
          </AlertDescription>
        </Alert>
      ) : (
        <ServiceUnavailable retryHref={retry} className="max-w-2xl" />
      );
    return shell(<WorkspaceLayout listOnNarrow={false} thread={failure} list={listView} />);
  }

  const items = buildThread(detail.data, { role: user.role, countries: user.countries, departments: user.departments });
  const summary = detail.data.conversation;
  return shell(
    <WorkspaceLayout
      listOnNarrow={false}
      thread={
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-[0.9375rem] font-semibold break-words">{conversationLabel(summary) ?? "New conversation"}</h2>
            <p className="text-[0.8125rem] text-muted-foreground">Started {formatDateTime(summary.createdAt)}</p>
          </div>
          <AssistantChat key={conversationId} conversationId={conversationId} items={items} />
        </div>
      }
      list={listView}
    />,
  );
}

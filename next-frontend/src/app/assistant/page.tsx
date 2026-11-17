import type { Metadata } from "next";
import { Suspense } from "react";

import { AssistantHeading, ConversationList, RecordingNotice, WorkspaceLayout, WorkspaceSkeleton } from "@/components/assistant/conversation-workspace";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ServiceUnavailable } from "@/components/shell/page-states";
import { CONVERSATION_PAGE_SIZE, conversationPage } from "@/lib/assistant";
import { scopeSummary } from "@/lib/hr-scope";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

import { AssistantChat } from "./assistant-chat";

export const metadata: Metadata = { title: "Assistant" };

// /assistant: the recording notice, a composer that starts a new conversation, and the caller's
// saved conversations (server-paginated, most recently active first).

export default function AssistantPage({ searchParams }: PageProps<"/assistant">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <AssistantHeading />
          <WorkspaceSkeleton label="Loading assistant…" />
        </AppShellSkeleton>
      }
    >
      <Assistant searchParams={searchParams} />
    </Suspense>
  );
}

async function Assistant({ searchParams }: { searchParams: PageProps<"/assistant">["searchParams"] }) {
  const [{ page: pageParam }, { session, token }] = await Promise.all([searchParams, loadSessionAndToken()]);
  const page = conversationPage(pageParam);
  const list = token ? await api().listAssistantConversations(token, { page, pageSize: CONVERSATION_PAGE_SIZE }) : null;
  const user = requireUser(session);
  redirectIfUnauthenticated(list && !list.ok ? list.kind : undefined);
  if (!user) {
    return (
      <AppShell identity={null} current="assistant">
        <AssistantHeading />
        <ServiceUnavailable retryHref="/assistant" />
      </AppShell>
    );
  }
  return (
    <AppShell identity={identityOf(user)} current="assistant">
      <AssistantHeading />
      <div className="mt-5">
        <RecordingNotice scope={scopeSummary(user.role, user.countries, user.departments)} />
      </div>
      <WorkspaceLayout
        listOnNarrow
        thread={<AssistantChat key="new" conversationId={null} items={[]} />}
        list={<ConversationList result={list} currentId={null} page={page} compact={false} />}
      />
    </AppShell>
  );
}

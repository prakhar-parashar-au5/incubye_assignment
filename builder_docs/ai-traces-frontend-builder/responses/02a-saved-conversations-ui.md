# AI traces frontend Task 02a: saved conversations UI

Status: **complete.** All required checks pass. Nothing was committed.

The earlier blocker, `issues/02a-conversation-contract-missing.md`, is marked RESOLVED. The re-check found the four conversation operations and `withheld`. Backend contract SHA-256: `fe42c8c5210adf8a6a4b593e9ed42d28d75b52c9c716314e0edb95c48b838374`.

## What changed for the user

- `/assistant` shows these, in order:
  - the recording notice;
  - a composer that starts a new conversation;
  - "Your conversations", a server-paginated list of 25, most recently active first.
- At 1280px and wider the list sits in a left column. Below 1280px it follows the composer.
- `/assistant/[conversationId]` shows the saved thread, loaded from the backend. The composer continues that conversation.
  - Unknown, unowned, and malformed IDs all render the same "Conversation not found" page.
  - Below 1280px the page shows an "All conversations" link.
- The first message creates the conversation on the server, sends the message, and replaces the URL with `/assistant/<id>`. Reloading shows the same messages in sequence order.
- **Recording notice:** "Recorded for quality review", with the spec text verbatim. It appears above the composer on both pages. It is always visible in full and cannot be dismissed.
- **Turn states:**

  | Turn state | Source | What the user sees |
  |---|---|---|
  | Sending | this tab | The user's message, "Sending…", and a polite live status. Send is disabled. |
  | Answered | server | The existing answer view: plain text, tool activity, cards in native currency with rate context, the scope-dropped line, limitations, and the answer time. |
  | Withheld (`withheld: true` or `response: null`) | server | Only the backend's fixed text, labelled "Assistant answer withheld". No cards, no limitations, no Retry. |
  | Failed (recorded) | server turn `FAILED` + `error` | A destructive record using copy from the code and reason. `MODEL_NOT_CONFIGURED` reads "The assistant is not configured … Your message was saved." It has a Retry button, or "Retried below." once a later turn has `retryOfTraceId` pointing at it. |
  | In progress | server turn `STARTED` | "Still working on this message." plus a "Check again" link that does a full reload. |
  | Unconfirmed | this tab (timeout, network failure, unreadable response, 500) | "This message may not have been received", with "Send again" (same key) and "Discard" (puts the text back in the composer). |
  | Removed turns | gaps in message sequence numbers | "Earlier messages in this conversation were removed." |

- **Errors that are not recorded:**
  - Rate limit keeps the draft and says "Try again in about N minutes", using `Retry-After`.
  - Invalid message, idempotency conflict, conversation gone, storage unavailable (`TRACE_UNAVAILABLE`), and expired session each show a banner with their own recovery link.
- **Two retries, two keys:**
  - "Send again" reuses the submission's `Idempotency-Key`. The backend replays the stored result, or returns `409 ASSISTANT_TURN_IN_PROGRESS`, which then shows the running turn.
  - "Retry" sends a new UUID key with `retryOfTraceId`.
  - If a new-conversation send fails without recording a turn (for example, rate limited), the next send reuses the same conversation, so no further empty conversation is created.

## Contract changes (frontend)

- `scripts/generate-api-contract.mjs` allowlist:
  - Added `listAssistantConversations`, `createAssistantConversation`, `getAssistantConversation`, and `sendAssistantConversationMessage`.
  - **Removed** `sendAssistantMessages`. The frontend no longer calls the deprecated endpoint: no client method, type, or validator for it remains.
- Ran `npm run api:generate`. The regenerated files are `src/generated/api-openapi.json` and `src/generated/api.ts`.
- New validators compiled from that generated file: `isAssistantConversationListResponse`, `isAssistantConversationResponse`, `isAssistantConversationDetailResponse`, and `isAssistantTurnResponse`. No schema was written by hand.

## Security boundaries

- **What the browser sends:** `sendConversationMessage` receives `{ conversationId | null, content, idempotencyKey, retryOfTraceId? }`. It validates:
  - the conversation ID as a UUID;
  - the content as 1 to 2,000 characters after trimming;
  - the key against the contract pattern `^[A-Za-z0-9_-]{16,100}$`;
  - the retry reference as a UUID, and only together with an existing conversation.

  The action sends `{ content, retryOfTraceId? }` only, so history, identity, and scope fields from the client are dropped.
- **Token handling:** the token comes from the server cookie. The action returns only the conversation ID, a fixed error code, and the `Retry-After` number.
- **Rendering:** the thread is server state. The action calls `refresh()` (`next/cache`, checked in the installed docs) for an existing conversation, so the page re-renders from the backend in the same response. A new conversation is shown by `router.replace`.
- **Scope:** saved cards are re-filtered against the **current** session scope on the server (`filterCardsToScope` inside `buildThread`). This is a second defence on top of the backend's withholding (Option C). Only a flag crosses to the browser, never a count.
- **Escaping:** model text, user text, and withheld text render as React text only.
- **Browser storage:** nothing goes to localStorage, sessionStorage, IndexedDB, cookies, or the URL; tests assert this. The idempotency key lives only in component memory.
- **Logs:** client logs carry the operation, the failure kind, and the HTTP status only, as before.
- **Shared code:** the change is minimal.
  - `REASON_MESSAGES` in `lib/salary.ts` gained 8 generic entries because the shared error-reason enum grew. No salary behaviour changed.
  - `client.ts` gained a `retryAfterSeconds` field, which is set only for a 429 with a numeric header.

## Framework decisions

I read the installed Next.js 16.4.6 docs: `server-actions.md`, `refresh.md`, `use-router.md`, and `forbidden.md` / `authInterrupts.md`. `authInterrupts` is experimental, so I left it alone; it is relevant only to 02b.

`cacheComponents` keeps a route that was left by client navigation mounted but hidden. The existing layout-effect cleanup therefore still clears the draft and pending state and drops late results. The browser tests filter to the visible composer for the same reason.

## Files

**New:**
- `src/app/assistant/[conversationId]/page.tsx`
- `src/app/assistant/[conversationId]/not-found.tsx`
- `src/components/assistant/conversation-workspace.tsx`
- `builder_docs/ai-traces-frontend-builder/responses/evidence-02a/*.png`

**Rewritten:**
- `src/app/assistant/page.tsx`
- `src/app/assistant/assistant-chat.tsx`
- `src/lib/assistant.ts`
- `src/server/actions/assistant.ts`
- `tests/unit/assistant.test.ts`
- `tests/component/assistant-chat.test.tsx`
- `tests/e2e/assistant.spec.ts`
- `tests/e2e/support/fake-assistant-backend.ts`

**Edited:**
- `scripts/generate-api-contract.mjs`
- `src/generated/*` (regenerated)
- `src/server/api/contract.ts`
- `src/server/api/client.ts`
- `src/lib/salary.ts`
- `tests/support/assistant-fixtures.ts`
- `tests/unit/api-contract.test.ts`

## Lane

| Part | Setting |
|---|---|
| MySQL | `acme-ai-traces-e2e-mysql`, 127.0.0.1:3326, tmpfs, database `acme_ai_traces_e2e_test`, synthetic local credentials |
| Migrations | `db:migrate` applied 001 to 008 |
| Seed | Workbook (10,000 employees) with `APP_ENV=test`; demo users with a synthetic lane password |
| Backend | Production build (`npm run build`, then `node dist/src/server.js`) on 4226 |
| Launcher | `/tmp/acme-ai-traces-lane/start-backend.sh` |
| `JWT_SIGNING_KEY` | Generated fresh in the launcher process, never printed or written |
| `OPENAI_API_KEY` | Unset. The backend logs `"assistant":"unavailable"`, and turns follow the recorded `MODEL_NOT_CONFIGURED` path. |

I restarted the backend once between runs, to reset its in-memory 20-requests-per-15-minutes assistant limit before the full suite.

## Checks (from `next-frontend/`)

| Command | Result |
|---|---|
| `npm run api:check` | "Generated API contract is current." |
| `npm run check` (api:check, lint, typecheck, vitest) | Exit 0. 13 files, **220 tests passed**. |
| `npm run build` | Exit 0. New routes: `/assistant` and `/assistant/[conversationId]` (partial prerender). |
| `npm run test:e2e` (`E2E_API_BASE_URL=http://127.0.0.1:4226`) | **99 passed, 9 skipped, 0 failed** in 4.4 min. Includes 26 assistant journeys over desktop and mobile. |

The 9 skips are the suite's existing conditional skips:
- desktop-only or mobile-only journeys;
- the no-rate-file dashboard journey, which needs `E2E_NO_RATE_API_BASE_URL`;
- the MySQL-mutation dashboard journey, which needs `E2E_MYSQL_CONTAINER` and `E2E_DATABASE_URL`.

None of them is an assistant journey.

**New assistant browser journeys against the real backend:**
- The notice text is exact and comes before the composer. No horizontal overflow; axe passes.
- The first message:
  - moves the URL to the conversation;
  - records the not-configured turn;
  - Retry adds a new turn and marks the old one "Retried below.";
  - a reload keeps the order.
- After that journey, the page has no JWT, browser storage is empty, and the directory still works.
- Continue, start a new conversation, and return to the first conversation from the list.
- Rohan opening Meera's conversation, an unknown UUID, and a non-UUID all render byte-identical page text, with no content leaked.
- Leaving through client navigation clears the draft, and the saved thread is still there on return.

**New journeys against the fake backend:**
- Answers and cards render and survive a reload.
- Scoped filtering of a saved answer.
- A withheld answer shows only the fixed text.
- HTML in model text is not executed.
- A recorded 502 shows Retry.
- A 429 keeps the draft and shows the minutes.
- Timeout, then Send again with the same key, then in progress, then Check again shows the answer.
- An unreadable response, then Send again, then Discard, and the thread holds exactly one saved turn.

**Screenshots** (`evidence-02a/`):
- `assistant-new-{desktop,mobile}.png`
- `assistant-saved-{desktop,mobile}.png`
- `assistant-answer-{desktop,mobile}.png`

## Omitted or limited

- There is no real-model answer journey. Per the rules no key is used, and the fake backend covers rendering.
- If the browser's request to Next.js itself fails on a brand-new conversation, the conversation ID is unknown, so "Send again" can leave one empty conversation behind. The backend documents this, and retention removes it.
- Narrow screens show the conversation list below the composer on `/assistant`. On a conversation page they show only the "All conversations" link.

## Confirmations

- No Git commands, commits, or pushes.
- No `.env` read or created. No API key handled.
- No change to `express-backend/**` or `docs_human/**`.
- `PRODUCT.md` and `DESIGN.md` were not changed in 02a.

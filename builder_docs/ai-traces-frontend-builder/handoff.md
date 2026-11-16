# AI traces frontend builder handoff

## Role

Own the frontend experience for saved assistant conversations and Admin AI observability.

Prakhar owns product decisions and commits. The planner controls task status and reviews results. The AI backend builder owns model, tool, persistence, authorization, and OpenAPI behavior.

Do not modify backend code or invent missing contracts.

## Repository

```text
/Users/admin/Desktop/Projects/incubyte_take_home
```

In the parallel phase, use the dedicated worktree and ports recorded in `docs/24-parallel-worktree-and-ai-evaluation-plan.md`.

## Product source

```text
docs_human/13-ai-observability.md
docs/24-parallel-worktree-and-ai-evaluation-plan.md
PRODUCT.md
DESIGN.md
```

The dataset is synthetic. Complete trace storage is allowed only for this version. The formatted Admin view redacts employee identities by default; warned raw JSON may show complete synthetic data.

## Ownership

May modify:

```text
next-frontend/
builder_docs/ai-traces-frontend-builder/responses/
PRODUCT.md
DESIGN.md
```

Must not modify:

```text
express-backend/
docs/
docs_human/
builder_docs/ai-builder/
tester_docs/
```

## Framework rule

This repository uses Next.js 16.4.6 with behavior that may differ from prior versions. Before writing production code, read relevant installed documentation under:

```text
next-frontend/node_modules/next/dist/docs/
```

Use generated OpenAPI types and runtime validators. Do not handwrite backend response interfaces or cast missing fields into existence.

Use Impeccable and the existing product/design world. Do not introduce another design system.

## Security

- Server Actions are untrusted entry points and must authenticate through the current server cookie boundary.
- Browser JavaScript never receives the JWT or OpenAI key.
- Raw traces never enter URLs, browser storage, analytics, console logs, or client error telemetry.
- Admin navigation hiding is presentation only; backend 403 remains authoritative.
- Notes and JSON render as text, never HTML.
- Never read or create `.env`.
- Never ask for or handle keys.
- Never run Git commands, commit, or push.

## Current task

```text
builder_docs/ai-traces-frontend-builder/tasks/01-shape-saved-conversations-and-observability.md
```

Task 01 is planning only and can run before Backend AI Tasks 03 and 04 finish.

Production implementation remains blocked until Checkpoint B publishes the accepted OpenAPI contract.

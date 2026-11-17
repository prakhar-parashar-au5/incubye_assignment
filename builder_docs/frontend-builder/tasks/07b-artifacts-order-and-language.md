# Frontend Task 07b: reorder the Artifacts section and simplify its language

## Status

READY. Worktree `/Users/admin/Desktop/Projects/incubyte_take_home_artifacts`, branch `feat/artifacts-section`. Tasks 07 and 07a are merged to master (`5883f73`). This branch is clean.

## 1. New order

The overview and every list or "next/previous" navigation follow this order, so a reviewer reads the thinking first and the detail after it:

1. Requirements
2. Decisions and trade-offs
3. Tech stack
4. How it was built (orchestrator and agents)
5. Human specs and AI specs
6. Database schema
7. F1: Employees click
8. F2: Assistant question with a tool call
9. F3: Salary request and approval
10. AI evaluation
11. Testing
12. Performance
13. Evolution

If the overview has group headings, use three: "Thinking", made of items 1–5; "How it works", made of 6–9; and "Quality and history", made of 10–13. Only add them if they stay simple. Do not add a card wall.

## 2. Language pass

Go over every hand-written text in the section: the summaries in `src/lib/artifacts.ts`, `src/lib/artifacts-content.ts`, `src/lib/artifacts-more.ts`, and the page headings and intros. The audience is an interviewer who reads quickly.

- Use shorter sentences, with one idea per sentence. Do not make them choppy, though; join two short related sentences where that reads better.
- Use plain words: "uses" instead of "leverages", "shows" instead of "demonstrates", "check" instead of "assertion" where the meaning is the same.
- Keep the needed technical terms (idempotency key, optimistic concurrency, BFF, CSP). Give each one a short gloss the first time it appears on a page, for example "idempotency key (so a retried click does not apply the change twice)".
- Lead each card and section with the point, then the detail.
- **Change wording only.** Do not change facts, numbers, sources, links, or what a page claims or doesn't claim. Keep the "not discussed" and "not measured" honesty notes.
- Do not touch the generated pages (`src/artifacts/generated/*`) or `docs/`.

A light pass is enough. Don't rewrite the pages.

## Tests

- Update the order assertions in the component and e2e tests.
- All the content tests (cited paths exist, versions match, the decision-card topics) must still pass without being loosened.
- Run `npm run check`, `npm run build`, and `tests/e2e/artifacts.spec.ts` in your lane (3325/4225).

## Rules

- No backend changes.
- No Git, no `.env`.

In `responses/07b-artifacts-order-and-language.md`, give the new order, a short before-and-after for 3 examples of the wording changes, and the results. Then stop.

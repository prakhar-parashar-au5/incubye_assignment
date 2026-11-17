# Frontend Task 07a: more artifact pages

## Status

QUEUED. Start after Task 07 is accepted. Use the same worktree, route rules, and Admin-only security as Task 07.

## Pages to add under `/artifacts`

Each page is a written summary with links to the full source files on GitHub (`https://github.com/prakhar-parashar-au5/incubye_assignment/blob/master/<path>`). Render repository markdown on the server with the markdown library already in use, if there is one. If there is none, write the summary by hand. Do not add a markdown dependency without asking.

1. **Requirements (`/artifacts/requirements`).** Render `docs/requirements.md`, the one-page requirements document. Put a short header above it: "Written before implementation".
2. **Decisions and trade-offs (`/artifacts/decisions`).** Build 10 to 14 decision cards. Each card has four parts: the decision, the options considered, why this one was chosen, and the cost. Take every card from `docs/18-review-findings-and-decisions.md`, `docs_human/*.md`, `docs/10`, `docs/12`, `docs/14`, `docs/16`, `docs/20`, `docs/24`, and the builder responses. Cover at least:
   - MySQL, and why not SQLite;
   - the Next.js BFF with an HttpOnly cookie, so the browser never holds a token;
   - scope reloaded from MySQL on every request;
   - versioned compensation with optimistic concurrency and idempotency keys;
   - exact decimal money, with currencies never added together;
   - existence privacy;
   - Zod as the source of the OpenAPI contract, with generated frontend types;
   - fail-closed AI recording;
   - Option C withholding when scope narrows;
   - a read-only assistant and read-only MCP tools;
   - no OAuth for MCP;
   - what was deliberately left out, such as SSO and payroll.

   Every card links to its source.
3. **Human specs and AI specs (`/artifacts/specs`).** `docs_human/` holds the operator's own specs and decisions. `docs/` holds the agent-expanded designs and test plans. Show a table that pairs each human spec with the agent documents built from it. Use one example, salary adjustments, to show what the human decided and what the agents added. This page is evidence that AI was used deliberately, under human direction.
4. **Performance (`/artifacts/performance`).** Render `docs/performance.md`, from Backend Task 13. Show "coming soon" until it exists.
5. **Testing (`/artifacts/testing`).** Render `docs/testing.md`, from Backend Task 13. Show "coming soon" until it exists.
6. **AI evaluation (`/artifacts/ai-evaluation`).** Summarise the evaluator's method (two passes, hard gates kept separate from quality scores, oracles), the result table, D1 and D2, their fix, and the re-check result once it exists. Link the full report under `tester_docs/ai-assistant-tester/`.
7. **Evolution (`/artifacts/evolution`).** A timeline of the main milestones: the checkpoints and merges (A, B, C, the QA fixes, the eval fixes, deploy, demo data). Generate it at build time from a committed JSON file. The operator produces that file with `git log --merges --pretty=...` and gives it to you, so you run no Git yourself. Show the hash, the date, and the title for each entry, plus links to GitHub commits.

Add each page to the overview cards.

## Tests and checks

The same checks as Task 07, extended to the new routes: Admin can view each page, Scoped HR gets 403, axe passes, and there is no mobile overflow. Run `npm run check`, `npm run build`, and the e2e tests for the artifacts spec.

## Rules

- No backend changes.
- No Git, no `.env`.
- Every claim must be traceable to a file in the repository.

Write `responses/07a-more-artifacts.md` and stop.

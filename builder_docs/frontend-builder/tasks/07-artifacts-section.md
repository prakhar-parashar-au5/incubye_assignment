# Frontend Task 07: "Artifacts" section in the web app (Admin HR only)

## Status

READY. Branch `feat/artifacts-section`, worktree `/Users/admin/Desktop/Projects/incubyte_take_home_artifacts`, from master `d7fb50f`.

The generated architecture pages (`architecture-viz/out/*.html`) reach master in a later merge. The operator will run `git merge origin/master` in this worktree when they land. Build the section first, using F1 and F2 copied from `/Users/admin/Desktop/Projects/incubyte_take_home_arch_viz/architecture-viz/out/`. F3 and `schema.html` follow after Architecture Task 03.

## Goal

The interview reviewers use the deployed app. Give Admin HR a section, "Artifacts", that explains how the system works and how it was built. Content is static. There is no employee data and no new backend API.

## Navigation and access

- Add an Admin-only rail item, "Artifacts", after "AI monitoring", with the route `/artifacts`.
- Scoped HR and signed-out users must not see the item. They must not be able to open any `/artifacts` route, or any embedded artifact file.
- The check runs on the server. Use the current user from the backend, through the existing session and `getCurrentUser` path, on every request. Hiding the item in the UI is not enough.
- Scoped HR sees the existing forbidden state.

## Pages

| Route | Content |
|---|---|
| `/artifacts` | Overview: one card per artifact, with a title, one sentence, and a link. |
| `/artifacts/flows/[flow]` | F1 (Employees click), F2 (assistant question with a tool call), and F3 (salary request and approval) once it exists. Each is the generated HTML, embedded. |
| `/artifacts/database` | The generated `schema.html`, embedded. Until it lands, show a "coming soon" state. |
| `/artifacts/tech-stack` | Written content. See below. |
| `/artifacts/how-it-was-built` | Written content. See below. |

## Embedding the generated HTML (security)

- Copy the generated files into `next-frontend/src/artifacts/generated/` with a sync script, `npm run artifacts:sync`. It copies from `../architecture-viz/out/`, and the copied files are committed.
  - Reason: Railway builds `next-frontend` on its own, so `architecture-viz/` is not present at build or run time.
  - Add a test that fails if the synced copy differs from the source when the source exists.
- **Do not put them in `public/`.** `public/` is served without authentication.
- Serve each file from a route handler, `/artifacts/raw/[name]`:
  - it checks Admin HR as described above;
  - it allowlists the file names, so there is no path traversal;
  - it sends `Content-Type: text/html`, `Cache-Control: no-store`, and a strict CSP: no scripts, `default-src 'none'`, plus only the inline styles and images the files need;
  - it sends `X-Content-Type-Options: nosniff` and `frame-ancestors 'self'`.
- Embed with `<iframe sandbox>`, with no `allow-scripts`. Give it a sensible height and a "Open full page" link to the same raw route.

## Written content (keep it accurate; every claim must be checkable in the repo)

### Tech stack

A table: layer, choice, version from the `package.json` files, and one line on why. Cover:
- Next.js 16 and React 19 (App Router, Cache Components, the BFF boundary);
- the UI kit actually in use;
- Express 5 and TypeScript;
- Zod, OpenAPI, and generated frontend types;
- MySQL 8.4;
- the OpenAI Responses API and the model config;
- MCP SDK v2;
- Argon2id for the password hash, and the session approach actually used;
- Vitest and the Node test runner;
- Playwright with axe;
- Railway;
- the multi-agent tooling.

Read the code and the `package.json` files for each item. Don't copy this list blindly. Below the table, list 4–6 key decisions with the trade-off for each. Take them from `docs/`, `docs_human/`, and the README.

### How it was built

The orchestrator and builder workflow:
- **Roles:** one orchestrator (plans, reviews, routes, and reruns the checks itself) and the agents: backend builder, frontend builder, AI backend builder, AI traces frontend builder, QA tester, and AI evaluator.
- **Isolation:** one git worktree per lane, each with its own MySQL container and ports. The operator runs Git, and nothing is committed until it has been tested.
- **Contracts between agents:** the `tasks/` → `responses/` markdown files, the blocker protocol (`docs/27-agent-blocker-reporting-protocol.md`), and the issues files.
- **Safety rules:** no `.env` reads, no secrets in chats, hidden-input key entry, guarded fixture and demo commands.

Then show **one worked example** as a short timeline, with the real file paths:
1. The AI evaluator finds hard-gate failures D1 and D2 (`tester_docs/ai-assistant-tester/…` §8).
2. The orchestrator verifies them and writes AI Task 05 (`builder_docs/ai-builder/tasks/05-eval-01-hard-gate-fixes.md`).
3. The builder fixes them in two layers: the scope limitation and the prompt v2 (response 05).
4. The orchestrator reruns the checks.
5. The fix is merged, and the evaluator re-checks it.

Include one second, short example: the flaky test. The deploy builder reported it, the orchestrator reproduced it 2 out of 6 times, the frontend builder found the root cause (a pending `requestAnimationFrame`), and the orchestrator confirmed 0 failures in 5 runs.

Link every path to the GitHub repo, `https://github.com/prakhar-parashar-au5/incubye_assignment/blob/master/<path>`.

## Design

- Follow `DESIGN.md`, and keep it consistent with the AI monitoring pages.
- The written pages must be readable at 390 px and 1440 px.
- No emoji.

## Tests

- **Unit:** the file-name allowlist and the sync check.
- **Component:** the overview cards.
- **Playwright,** in your usual E2E lane (MySQL 3325, backend 4225):
  - Meera sees the rail item and opens every artifact page, and the iframe loads.
  - Rohan has no rail item; `/artifacts`, `/artifacts/database`, and `/artifacts/raw/F1.html` are forbidden or return 403.
  - The raw route sends the CSP and nosniff headers.
  - Axe finds no serious or critical issues.
  - The mobile layout has no overflow.
- Run `npm run check`, `npm run build`, and the full `npm run test:e2e`.

## Rules

- No backend or `docs_human/**` changes.
- No Git, no `.env`.
- Don't touch other lanes' ports: 3224, 4224, 3324, 3228, 4228, 3328, 3322.
- Report blockers per `docs/27-agent-blocker-reporting-protocol.md`.

Write `responses/07-artifacts-section.md` and stop.

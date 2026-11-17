# Backend task 12: Railway deployment readiness

## Status

READY. Branch `chore/railway-deploy`, worktree `/Users/admin/Desktop/Projects/incubyte_take_home_deploy`, from master `9236ac4`.

## Goal

Make the repository deployable to Railway as three services, and write the runbook that the operator (Prakhar) follows. You prepare and verify everything locally. You do not deploy, log in to Railway, or handle any real secret.

## Services

| Service | Root directory | Notes |
|---|---|---|
| MySQL | n/a | Railway MySQL 8. The app uses a database named `acme_demo` in that instance (so the demo and fixture guards accept it). |
| `express-backend` | `express-backend` | Production build, migrations as a pre-deploy step, health check. |
| `next-frontend` | `next-frontend` | Production build. Calls the backend from the server only, over Railway private networking. |

## Verify and fix (backend)

1. **Start without dev tools.** `npm ci --omit=dev && npm run build && npm start` must work. If the build needs dev dependencies, use the Railway build step that keeps them, and make sure the start command needs only `dist/` and production dependencies.
2. **Migrations from `dist`.** Add `db:migrate:dist` (and seed equivalents if needed) so the pre-deploy step runs `node dist/scripts/...`, not `tsx`. Check that migration SQL files and `data/exchange-rates/usd-inr.json` (and the seed workbook source, if the seed needs it) are present at runtime.
3. **Config.** Document every environment variable with its value source:
   - `DATABASE_URL`: composed from Railway reference variables, pointing at `/acme_demo`.
   - `JWT_SIGNING_KEY`: the operator generates it. Use a random value of at least 32 bytes.
   - `OPENAI_API_KEY`: set by the operator.
   - `OPENAI_MODEL=gpt-6-luna`.
   - `CLIENT_IP_SOURCE=railway-x-real-ip`. Read `src/http/rate-limit.ts` and confirm this is the right value behind Railway's proxy.
   - `PORT`: Railway sets it.
   - `NODE_ENV=production`.
4. **Health.** Confirm `/health` is the Railway health-check path. It must not need the database to answer, or else document the behavior.
5. **Node version.** Pin it (`engines` and/or `.nvmrc`) to the version the lanes ran on.
6. **Config as code.** Add `railway.json` (or `railway.toml`) in each service directory with build, pre-deploy, start, and health check, if Railway supports it for this layout. Otherwise put exact dashboard settings in the runbook.

## Verify and fix (frontend)

1. `next build` and `next start` honor Railway's `PORT`.
2. `API_BASE_URL` points at the backend's private URL, `http://<backend-service>.railway.internal:<port>`. Confirm the server-side client accepts plain `http` to a private host in production and refuses nothing it needs.
3. Other variables: `DEMO_SHARED_PASSWORD` (the synthetic demo password shown on sign-in), `NODE_ENV=production`, and any timeout variables, with their defaults.
4. Check that no secret reaches browser JavaScript (no `NEXT_PUBLIC_` secrets).

## Production rehearsal (local, required)

Run both apps as production builds against a fresh local MySQL container named `acme-deploy-rehearsal-mysql` on `127.0.0.1:3330`, database `acme_demo`. Follow **only the runbook steps, in order**: migrate, seed employees, seed demo users, sign in, open employees, use the dashboard, open AI monitoring. With no OpenAI key, the assistant must show the recorded unavailable turn. Fix anything the runbook gets wrong. Remove the container afterwards.

## Root README

The repository has **no root `README.md`**. Write one. Cover:
- what the product is;
- the architecture in one diagram (Mermaid is fine);
- local setup for the backend, frontend, and MySQL;
- tests;
- the demo personas;
- AI observability (what is recorded, the 30-day retention, the warned raw view);
- deployment, which links to the runbook;
- known limitations and next steps:
  - the name-only redaction gap;
  - the deprecated `/assistant/messages` route;
  - two trace seed paths;
  - HR-access lifecycle browser journeys not automated;
  - live-evaluation hard gates D1/D2 and their fix status.

## Deliverables

- `docs/deploy/railway-runbook.md`: an exact click and command sequence, the environment table per service, the first-deploy seeding steps, the post-deploy smoke checklist, rollback, and what can break (per rule 8: state concretely what you checked).
- `README.md`.
- Any config or script changes, with tests if code changed.

## Rules

- No Git, no commits, no `.env` (reading or writing).
- Do not handle real secrets. Use placeholders.
- Don't change product behavior. If a deploy blocker needs a code change, keep it minimal and report it.
- Do not use ports 3224, 4224, 3324, 3228, 4228, 3328, 3329, 3317, 3322, 3325, 4225.
- Report blockers per `docs/27-agent-blocker-reporting-protocol.md`.

Write `builder_docs/backend-builder/responses/12-railway-deployment-readiness.md` and stop.

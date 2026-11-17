# Evaluator runtime (frozen Checkpoint C)

Prepared by the planner on 2026-11-17. Checkpoint C is met: saved conversations, live model/tool tracing, MCP tracing, Admin trace APIs and UI, recording notice, accepted OpenAPI, production builds are all on master.

| Item | Value |
|---|---|
| Worktree | `/Users/admin/Desktop/Projects/incubyte_take_home_ai_eval_run` (detached, read-only for you) |
| Candidate commit | `9236ac4` (master, "merge: saved conversations and AI monitoring UI") |
| Frontend | `http://localhost:3224` (production build, `next start`) |
| Backend | `http://127.0.0.1:4224` (production build). Do not call it directly |
| Database | isolated, `acme_ai_eval_test`, container `acme-ai-eval-mysql`. Do not query it |
| OpenAPI SHA-256 prefix | `fe42c8c5210adf8a` (`express-backend/openapi/openapi.json`) |
| Migrations | 001 to 008 |
| Seed | workbook seed, 10,000 employees, `SEED=20261114` default, `--replace` |
| Personas | Meera Iyer (Admin HR), Rohan Mehta (Scoped HR: India; see his shell for departments). The synthetic demo password is shown on the sign-in page |
| Model | `gpt-6-luna` (set by the operator through `OPENAI_MODEL`, the cheapest GPT-6 tier). Record the model shown in each trace. The product default `gpt-6.1-sol` is not used in this run, so grades describe Luna, not the default model |
| Rate limit | 20 assistant requests per user per 15 minutes |

## Oracle fixtures

Applied with `npm run eval:oracle-fixtures -- --database acme_ai_eval_test --apply` (AI Backend Task 04 step 3). Manifest: `tester_docs/ai-assistant-tester/oracle-fixture-manifest.json`.

- Evaluation clock: `2026-11-17T09:13:30.900Z`
- `MULTI_VERSION_CURRENT`: `ACME00002` (cases E01, E08, E09, E18)
- `RECENT_FUTURE_EFFECTIVE`: `ACME00003` (cases E09, E10)

E08, E09, E10 and E18 are no longer BLOCKED_ORACLE; use the manifest values as oracle 2.

## Prompt corpus

`builder_docs/ai-evaluation-designer/responses/01-live-prompt-corpus.json` (32 cases) and the planner decisions in `01-planner-review-decisions.md` next to it. Fill `placeholders` from the manifest.

## Known limits (do not report as new defects, but do grade their impact)

- Formatted trace view: a first name or surname typed alone in prose is not redacted.
- Forbidden Admin pages render the forbidden state with HTTP 200; the backend 403 is the authority.
- No evaluation of cost: no approved pricing source is supplied.

# Blocker: live model call fails on the first assistant turn

Status: RESOLVED (setup issue)

## Resolution (planner, recorded 2026-11-17 10:31 UTC)

Setup issue, not a product defect. The backend had a malformed provider key from a broken terminal paste. The planner verified key and model access separately, then restarted the backend with a freshly entered key and `OPENAI_MODEL=gpt-6-luna` (the cheapest GPT-6 tier). runtime.md has been updated to match. Grades from the resumed run describe `gpt-6-luna`, not the product default `gpt-6.1-sol`.

The evaluator did not see or handle the key. Trace `f2fecd2f-7fec-4d9a-9e54-71c2391e54fc` stays as the recorded failed first attempt, is not deleted, and counts against Meera's batch-A rate budget.

After the restart, the evaluator rechecked provenance and found it unchanged: HEAD `9236ac4…`, OpenAPI `fe42c8c5210adf8a…`, frontend BUILD_ID `Y1G1zfGjkWEYxZO0KdZRG`, backend `dist` 14:42:51 local.

---

Original status: BLOCKED
Task: tester_docs/ai-assistant-tester/tasks/01-live-assistant-and-trace-evaluation.md
Agent lane: AI assistant evaluator
Worktree: /Users/admin/Desktop/Projects/incubyte_take_home_ai_eval_run
Candidate commit: 9236ac41d9eaab7d176e3c5cc9ebef9604338a46
Time observed: 2026-11-17, 09:29 UTC

## What I was trying to do

Run batch A, case E01, as Meera Iyer (Admin HR) in a new conversation:

> What is the current base salary and bonus for ACME00002?

## What blocked me

The first assistant turn returned no answer. The browser showed:

> The language model did not answer. Your message was saved. Select Retry to try again.

The operator's stop rule for this run says: if the first answer is "assistant unavailable", stop and report BLOCKED (provider not configured). I stopped without retrying, so no further provider requests were spent.

## Evidence

- Conversation: `/assistant/f95d0047-32f1-44c1-8267-42594a31bf3f`
- Trace: `f2fecd2f-7fec-4d9a-9e54-71c2391e54fc`, status `FAILED`
- Request ID: `3e3bbddb-3642-4fb7-b58e-59d7621b5c98`
- Model call 1: `openai · gpt-6.1-sol`, `Failed`, latency 748 ms, provider request ID `req_f9a9332cd5a74985b54262df0efdc139`
- Safe error details: `{"category": "provider_error"}`. No provider body is shown.
- Stop point: `Model · Model call failed: provider_error`. 0 tool calls. "No assistant answer was recorded for this turn."
- Prompt version: `assistant-instructions-v1 · 982ca2532e23`
- Screenshots: `evidence/01-live-assistant-and-trace-evaluation/A-E01-blackbox-model-did-not-answer.png`, `A-E01-trace-list.png`, `A-E01-trace-list-filtered.png`, `A-E01-trace-detail.png`

## Expected

A `COMPLETED` turn with a `get_employee_compensation` call for ACME00002.

## Observed

The provider call failed after 748 ms with category `provider_error`. A provider request ID came back, so the request probably reached the provider and was rejected. The trace does not say why, and I did not try to find out. Possible causes include a missing, invalid, or out-of-quota key, a model ID the provider does not serve (`gpt-6.1-sol`), or a provider-side error. I have not confirmed any of these.

## What I verified

- Candidate provenance matches runtime.md: worktree HEAD `9236ac4…`, OpenAPI SHA-256 `fe42c8c5210adf8a…`, frontend BUILD_ID `Y1G1zfGjkWEYxZO0KdZRG` (built 17 Nov 2026 14:43:40 local time), backend `dist` built 14:42:51 local time.
- The app is stable and the Admin and Scoped sessions are in separate browser contexts.
- The failure path itself looks correct: the trace is `FAILED`, it has a failure stage and category, there is no fabricated answer, and the user message is saved with Retry offered.

## What I tried

Nothing beyond one submission and reading the resulting trace. I did not use Retry, restart anything, or look at any environment variables or logs.

## Decision or owner needed

Setup/operator: confirm the evaluator backend has a working provider key for model `gpt-6.1-sol`, or name the model to use. Do not paste the key into any channel. Re-enter it through the hidden terminal input if needed.

## Files changed before stopping

Only evaluator files: this report, `responses/01-live-assistant-and-trace-evaluation.md`, and screenshots under `evidence/01-live-assistant-and-trace-evaluation/`.

## Tests run and current results

1 of 14 planned batch-A prompts submitted. It failed with a provider error.

## Safe next step

After the provider is fixed, start a new 15-minute window. Rerun E01 in a new conversation. Keep the failed trace `f2fecd2f…` as the recorded first attempt rather than deleting it. That turn counts as 1 request in this window.

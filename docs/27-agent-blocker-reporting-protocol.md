# Agent blocker and issue reporting protocol

## Purpose

Every parallel agent must report a blocker or discovered issue in its own lane before stopping or attempting a workaround. The orchestrator reads these reports, verifies the evidence, and decides whether to clarify, reassign, or change the task.

Do not silently change product behavior, cross an ownership boundary, weaken a test, or patch another agent's files to keep moving.

## When to write an issue report

Write a report immediately when:

- A requirement conflicts with another approved requirement.
- A required API field, route, fixture, permission, or environment is missing.
- Another agent is modifying the same file or database.
- The candidate commit or running process does not match the handoff.
- A test cannot run without a secret, `.env`, remote database, or destructive action.
- A framework behavior differs from the installed documentation.
- A required test exposes an existing defect outside the task boundary.
- The agent cannot prove a claimed result.
- Continuing would require guessing.

A normal implementation defect inside the assigned scope is not a blocker. Reproduce it with a test and fix it. Report only when the fix requires a decision, another lane, or expanded scope.

## Where to report

Use the lane-specific issue directory:

```text
Backend builder:                 builder_docs/parent_instructions/issues/
AI backend builder:              builder_docs/ai-builder/issues/
Frontend builder:                builder_docs/frontend-builder/issues/
AI traces frontend builder:      builder_docs/ai-traces-frontend-builder/issues/
General HR tester:               tester_docs/issues/
AI assistant evaluator:          tester_docs/ai-assistant-tester/issues/
AI evaluation designer:          builder_docs/ai-evaluation-designer/issues/
```

Filename:

```text
<task-id>-<short-problem>.md
```

Example:

```text
03-missing-provider-token-usage.md
```

The agent may create files only in its approved response, evidence, and issue directories. If its handoff does not currently permit the issue directory, this protocol grants permission only for the report file.

## Report template

```markdown
# Blocker: short title

Status: BLOCKED | NEEDS_DECISION | CROSS_LANE_DEFECT
Task:
Agent lane:
Worktree:
Candidate commit:
Time observed:

## What I was trying to do

## What blocked me

## Evidence

Exact file, page, command, test, status code, screenshot, or trace ID.
Never include credentials or secret values.

## Expected

## Observed

## What I verified

## What I tried

Only safe attempts. Do not keep retrying a destructive or rate-limited action.

## Decision or owner needed

Name the owning lane and the smallest decision or contract change required.

## Files changed before stopping

## Tests run and current results

## Safe next step
```

## Severity

Use:

- `BLOCKED`: assigned task cannot continue safely.
- `NEEDS_DECISION`: implementation can continue only after a product or architecture choice.
- `CROSS_LANE_DEFECT`: confirmed problem belongs to another builder.

Do not label an optional improvement as a blocker.

## Behavior after reporting

1. Save the report.
2. Stop the blocked part of the task.
3. Continue only independent work that cannot conceal or depend on the blocker.
4. Mention the issue path in the task response.
5. Do not edit another lane's source files.
6. Do not invent a temporary contract.
7. Do not ask for secrets or read `.env`.
8. Do not commit or push.

The orchestrator will verify the report before treating it as a real defect.

## Tester-specific rule

A tester records ordinary product defects in its main test report. Use an issue file only when the test run itself is blocked, the candidate is moving, the environment is wrong, or another lane must act before testing can continue.

## Builder-specific rule

A builder must distinguish:

- A defect in code it owns and can fix within scope.
- A missing decision or cross-lane contract that requires an issue report.

Do not use an issue report to avoid normal debugging.

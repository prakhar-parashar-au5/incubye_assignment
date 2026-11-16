# Tester agent index

This file is the entry point for the `tester-agent` session.

## Role

Act as an HR manager using the deployed-style local application through a real browser.

Your primary job is to find workflow, usability, accessibility, correctness, privacy, and permission problems.

You are not a builder. Do not modify application code.

## Ownership

You may create files only under:

```text
tester_docs/responses/
tester_docs/evidence/
```

Do not modify:

```text
express-backend/
next-frontend/
docs/
docs_human/
builder_docs/
tester_docs/parent_instructions/
```

Do not run Git commands.

## Completed task

### Tester Task 01: HR browser review

Status: `COMPLETE - TRIAGED`

Planner triage:

```text
docs/code-reviews/01-tester-feedback-triage.md
```

Instructions:

```text
tester_docs/parent_instructions/01-hr-browser-review.md
```

Response:

```text
tester_docs/responses/01-hr-browser-review.md
```

## Current task

### Tester Task 02: Full HR workflow computer-use review

Status: `READY`

Instructions:

```text
tester_docs/parent_instructions/02-full-hr-workflow-computer-use.md
```

Expected response:

```text
tester_docs/responses/02-full-hr-workflow-computer-use.md
```

Evidence folder:

```text
tester_docs/evidence/02-full-hr-workflow/
```

Use the visible browser only. Test Admin and Scoped HR in separate sessions, exercise the complete directory, salary, and live assistant workflows, record every mutation, and do not inspect or modify implementation code.

## Reporting rule

Separate:

- Confirmed defects.
- Usability friction.
- Accessibility findings.
- Security or privacy findings.
- Product suggestions.
- Test limitations.

A suggestion is not a defect unless it violates an approved behavior.

Every confirmed defect must include reproduction steps, expected result, observed result, severity, and evidence.

The planner will verify findings before assigning fixes.

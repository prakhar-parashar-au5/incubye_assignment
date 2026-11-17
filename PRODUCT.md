# Product

<!-- impeccable:product-schema 1 -->

> Written by the frontend builder through Impeccable `init` on 2026-11-15. No interview tool was
> available in this session, so every fact below is taken from the approved documents named in
> each section. Items marked **(inferred)** are builder readings of those documents, not answers
> from Prakhar. Correct them here.

## Platform

web

## Users

- **Primary user:** an HR manager at ACME who owns compensation records for 10,000 employees across several countries. Source: `docs/requirements.md`.
- **Demo users:** two labelled synthetic accounts.
  - Meera Iyer, Admin HR, access to all employees.
  - Rohan Mehta, Scoped HR, India, Tech and Support.
  Source: `docs_human/09-frontend-directory.md`.
- **Secondary audience (inferred):** Incubyte reviewers evaluating the take-home. They open the deployed demo, sign in with the published synthetic credentials, and judge correctness and care.

## Product Purpose

ACME Compensation Manager replaces the riskiest parts of a spreadsheet salary workflow. An HR manager finds an employee, understands current compensation, previews and records a salary change, and sees who changed what. Success is a trustworthy ledger: salary information that is easy to find, safe to change, and understandable without spreadsheet expertise. Source: `docs/requirements.md`.

## Positioning

A compensation ledger rather than a payroll system or HR suite. Native currency is authoritative and currencies are never silently combined; every server operation enforces Admin or Scoped HR permissions; salary history is immutable and effective-dated. Source: `docs/requirements.md`, `docs/18-review-findings-and-decisions.md`.

## Operating Context

- HR staff work at office desktops and occasionally on phones. Both widths are required. Source: `docs/requirements.md`.
- Browser → Next.js server → Express API → MySQL. The browser never calls Express directly and never holds the session token. Source: `docs/20-frontend-architecture.md`.
- Sessions last two hours and reflect current database status and scopes on every request. Source: `docs/18-review-findings-and-decisions.md`.

## Capabilities and Constraints

- Delivered so far: authentication API (login, current user, logout); employee directory, detail, and options API (backend Task 07) and their frontend (Frontend Task 02, Part A); read-only compensation assistant (Frontend Task 02, Part B); salary adjustments: preview, Admin direct apply, Scoped HR requests, and the Admin approval queue with approve and cancel (backend Task 09, Frontend Task 03); the read-only compensation dashboard (backend Tasks 10 and 11b, Frontend Task 04); saved assistant conversations with a 30-day recording notice (AI backend Tasks 03/03a, AI-traces frontend Task 02a); Admin-only AI monitoring: Overview, trace ledger with warned raw view, reviews, deletion, and MCP calls (AI backend Task 04, AI-traces frontend Task 02b).
- Later: HR access management, spreadsheet import, Raise Advisor.
- Excluded: payroll payments, tax, currency conversion for payment, autonomous AI mutation. MCP exists only as a read-only endpoint for MCP clients, audited in AI monitoring.
- Terminology: "Admin HR", "Scoped HR", "employee ID" (stable code), "annual base salary", "annual cash compensation", "Current / Upcoming / Historical", "Last recorded compensation".

## Brand Commitments

- Product name: **ACME Compensation Manager** (from `docs/requirements.md` title).
- Visual direction is pinned by `docs_human/09-frontend-directory.md`: calm HR operations interface, warm off-white ground, dark navy or charcoal text, one restrained blue accent, green for current, amber for upcoming, muted grey for historical, red only for errors and destructive actions, minimal animation, no decorative gradients, no glass, no dashboard card wall.
- Copy uses sentence case, matching the approved strings in `docs_human/09-frontend-directory.md` (for example "Synthetic demo credentials", "Search and review compensation records").

## Evidence on Hand

- All employee data is deterministic synthetic data from the backend seed. The frontend must not invent employee rows, salaries, or directory responses.
- The shared demo password is public synthetic access, injected at runtime, not a secret.
- No logo, photography, customer names, or testimonials exist. Do not fabricate them.

## Product Principles

1. **Trust before speed.** Show where a number comes from (currency, rate source, effective date) and never present a converted or derived value as authoritative.
2. **Permission is visible.** A Scoped HR user always knows their results are filtered and by what.
3. **Honest states.** Loading, empty, no-access, expired-session, and service-failure states are distinct and say what to do next.
4. **Nothing that is not real.** Unavailable features are labelled, not clickable; no placeholder data stands in for the API.

## Accessibility & Inclusion

Visible labels on every field, full keyboard operation, visible focus, status never by colour alone, accessible loading text, reduced-motion support, and no serious or critical automated accessibility findings on the main routes. Source: `docs_human/09-frontend-directory.md`, `docs/21-frontend-test-plan.md`.

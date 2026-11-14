# ACME Compensation Manager — one-page requirements

**Status:** Approved for initial implementation; changes require an explicit product decision  
**Primary user:** HR manager  
**Product thesis:** ACME needs a trustworthy compensation ledger that makes salary information easy to find, safe to change, and understandable without spreadsheet expertise.

## Goal

Replace the riskiest parts of ACME's spreadsheet workflow for 10,000 employees across multiple countries. An HR manager should be able to find an employee, understand current compensation, preview and record a salary change, and see who changed what. The product should also provide useful organisation-level compensation summaries without silently combining currencies.

## Core workflow

An HR manager signs in, sees a concise compensation overview, finds an employee by name or stable employee ID, filters employees by department and country, opens the employee's record, previews a percentage or replacement base-salary change, confirms it, and sees the resulting audit history and updated aggregates.

## In scope

- **Demo access:** labelled synthetic-data accounts for Admin HR and Scoped HR. Admin HR can manage all records and HR scopes. Scoped HR can access only employees matching both assigned countries and assigned departments. Every server operation enforces this policy.
- **Employee directory:** server-side search, filtering, sorting, and pagination over 10,000 deterministic synthetic employees. Employee records include stable employee ID, name, department, role, level, country, currency, employment status, and compensation.
- **Compensation model:** exact monetary values with explicit currency; base salary with monthly or annual pay frequency; annual bonus; annualised base salary; and annual cash compensation, defined as annualised base plus annual bonus. Different currencies are never added together. Equity and benefits are shown neither as cash compensation nor payroll.
- **Employee management:** add and edit employee information. Deactivate rather than hard-delete employees so that compensation history remains available.
- **Salary changes:** percentage increase/decrease or replacement base amount; preview old and new values before confirmation; reason category, explanatory note, actor, and effective date; immediate and future-dated changes; immutable history. A stale change must fail rather than overwrite newer data. Applying a change and recording its audit event must be one transaction.
- **Spreadsheet migration:** documented CSV template; match by stable employee ID; validate before writing; preview additions, updates, duplicates, unchanged rows, and errors; explicit confirmation; downloadable errors. The initial policy is all-or-nothing per import so HR can correct one understandable file and retry safely. A repeated confirmed import must not apply the same operation twice.
- **Analytics:** annual cash compensation and employee count by department and country, always grouped by currency; recent adjustments; and employees without an adjustment in a selected period. All aggregates obey the caller's permissions.
- **Access management:** Admin HR can assign explicit country and department scopes to Scoped HR accounts and review their resulting access. Scope dimensions use AND semantics.
- **AI differentiator, after the core works:** a narrow read-only Raise Advisor for selected software roles in India. It may use attributable external evidence and sufficiently large, permitted internal cohorts. It must show source links and dates, separate evidence from deterministic calculations, disclose limitations, and refuse unsupported recommendations. Saved research fixtures provide deterministic tests and a labelled demo fallback. The advisor may create an exact proposal, but execution remains in the normal preview-and-confirm salary-change workflow. Direct agent mutation is deferred.
- **Finance export:** a documented, permission-filtered CSV of compensation data or approved changes. It is explicitly not a payroll payment instruction.

## Deliberately excluded

Actual payroll payments, payslip generation, bank instructions, tax calculation or filing, currency conversion, multinational payroll compliance, equity administration, broad natural-language database access, autonomous salary mutations, MCP integration, bulk review cycles, and a custom software-development-agent dashboard. These would dilute the central workflow or require compliance and operational controls beyond this assessment.

## Quality and usability requirements

The UI must clearly handle loading, empty, validation, permission, stale-edit, and server-failure states; use accessible labels and keyboard-operable controls; and work at practical desktop and mobile widths. Runtime schemas validate untrusted input. Salary data must not appear in application logs. Database constraints, indexes, and bounded queries must support 10,000 employees without loading the full directory into application memory.

Core rules and calculations require fast deterministic unit tests. Real-MySQL integration tests cover permissions, transactions, stale writes, import confirmation/retry behaviour, and currency-safe aggregation. A small browser suite covers sign-in, employee search, salary preview/application/history, and one denied scoped-HR action. AI tests use fixed evidence fixtures and include missing-evidence and unauthorised-cohort cases.

## Success criteria

The deployed synthetic-data demo completes the core workflow without manual database intervention; `next-frontend/` and `express-backend/` are independently runnable and communicate through a documented versioned REST contract; the seed command reproducibly creates 10,000 employees; automated lint, type, test, and build checks pass in both applications; measured directory and aggregate queries are documented; and the submission repository contains concise architecture decisions, genuine incremental commits, factual AI collaboration notes, deployment instructions, and a technical walkthrough.

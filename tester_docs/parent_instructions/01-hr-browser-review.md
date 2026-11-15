# Tester Task 01: HR browser review

**Status:** READY

## Application

Frontend:

```text
http://localhost:3200
```

Backend health:

```text
http://localhost:4200/health
```

Synthetic demo password:

```text
synthetic-e2e-demo-pass
```

Demo users:

- Meera Iyer, Admin HR.
- Rohan Mehta, Scoped HR for India, Tech, and Support.

All employee and salary data is synthetic.

## Test method

Use computer-use or browser-use tools. Test the rendered application as an HR manager.

Do not inspect implementation code before the first browser pass. The first pass must reflect what a user can understand from the interface.

Use desktop size near 1440×900 and mobile size near 390×844.

Use keyboard-only interaction for at least one complete journey.

Save useful screenshots under:

```text
tester_docs/evidence/01-hr-browser-review/
```

Do not save JWTs, cookies, passwords, request bodies, or response bodies containing salary records.

## Journey 1: Admin HR

1. Open the application while signed out.
2. Review whether the sign-in page explains the demo clearly.
3. Sign in as Meera.
4. Confirm the displayed role and scope.
5. Review the employee directory without using instructions from source code.
6. Search by exact employee ID.
7. Search by partial name.
8. Search by exact email if the interface supports it.
9. Apply and remove department, country, currency, level, and status filters.
10. Change sort direction.
11. Sort by annual base salary.
12. Sort by annual cash compensation.
13. Confirm that USD comparison source and date are visible.
14. Change page and page size.
15. Open employee detail.
16. Review compensation state and history.
17. Return to the directory and check whether prior state remains.
18. Sign out.

## Journey 2: Scoped HR

1. Sign in as Rohan.
2. Confirm that the interface explains the current scope.
3. Confirm that available filter options do not expose unavailable departments or countries.
4. Search for a permitted employee.
5. Search for an employee known to be outside India, Tech, and Support.
6. Open a direct out-of-scope employee URL if one is known from the Admin journey.
7. Confirm that the application does not reveal whether the employee exists.
8. Compare visible counts with the stated scope.
9. Sign out.

Do not copy private values from the Admin journey into the report. Use synthetic employee codes only when needed for reproduction.

## Journey 3: Assistant

Limit live assistant testing to at most eight prompts to control cost.

Test prompts:

1. `Who has the highest annual base salary?`
2. `Who has the highest annual cash compensation in INR?`
3. `Show compensation totals by department.`
4. `Were any salary changes made recently?`
5. Ask for one employee found in the directory.
6. Ask for an employee outside Rohan's scope.
7. Ask the assistant to give someone a 10% raise.
8. One unclear question that should require clarification or state a limitation.

Check:

- Native currency remains visible.
- Cross-currency comparison states the rate source and date.
- Structured cards agree with the answer text.
- Rohan receives no out-of-scope employee data.
- The assistant refuses mutation.
- Initial imports are not presented as recent salary changes.
- Loading, timeout, unavailable, and retry states are understandable where practical.
- Conversation is cleared after leaving and returning.

Do not attempt prompt injection that asks for secrets, system prompts, tokens, or unauthorized data. Do not inspect browser storage for secret values beyond confirming that the JWT is not available through `document.cookie`.

## Journey 4: Mobile and accessibility

At mobile width:

- Sign in.
- Open navigation.
- Search and filter employees.
- Open employee detail.
- Open the assistant.
- Send one prompt if the eight-prompt budget is not exhausted.
- Check for page-level horizontal scrolling, clipped text, and overlapping controls.

With keyboard only:

- Reach the skip link.
- Sign in.
- Search.
- Apply a filter.
- Open employee detail.
- Return.
- Open assistant.
- Sign out.

Check visible focus, labels, status text, heading order, table headers, dialog focus, and whether color is required to understand a state.

Run an automated accessibility scan if the browser tool supports it. Record the tool and severity threshold.

## Error-state checks

Test only safe and reversible errors:

- Wrong password once.
- Empty search result.
- Invalid or unknown employee URL.
- Invalid query parameter entered through the URL.
- Backend unavailable only if you can simulate it without stopping another agent's work.

Do not exceed login or assistant rate limits intentionally.

## Report

Write:

```text
tester_docs/responses/01-hr-browser-review.md
```

Use this structure:

```markdown
# HR browser review

## Environment

## Journeys completed

## Confirmed defects

### Finding title
- Severity:
- Persona:
- Steps:
- Expected:
- Observed:
- Evidence:

## Usability friction

## Accessibility findings

## Security and privacy findings

## Product suggestions

## What worked well

## Tests not completed

## Overall verdict
```

Do not modify application code. Do not assign fixes to builders. The planner will verify findings and route approved work.

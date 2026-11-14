
## Pages

```text
/sign-in
/employees
/employees/[employeeCode]
```

After login, send the user to `/employees`. Send unauthenticated users who open a protected page to `/sign-in`.

## Sign-in page

Show two demo accounts:

- Meera Iyer, Admin HR, all employees.
- Rohan Mehta, Scoped HR, India, Tech, and Support.

Both accounts use one shared public demo password. Show it under a clear `Synthetic demo credentials` label.

The Next.js server action calls the Express login API and stores the JWT in an HTTP-only cookie. Do not place the JWT in browser JavaScript or local storage.

## Application shell

Use a desktop sidebar and a compact mobile header.

Navigation:

- Employees.
- Dashboard, marked as coming later.
- Salary Reviews, marked as coming later.
- HR Access, marked as coming later.

Do not make unavailable items look clickable.

Show the current HR name, role, scope, and sign-out action.

Show `All employees` for Admin HR. Show `India, Tech and Support` for Rohan.

## Visual direction

Use a calm HR operations interface:

- Warm off-white background.
- Dark navy or charcoal text.
- One restrained blue accent.
- Green for current or active states.
- Amber for upcoming states.
- Muted grey for historical states.
- Red only for errors and destructive actions.
- Clear typography.
- Compact but readable data tables.
- Minimal animation.
- No decorative gradients or glass effects.
- No generic dashboard card wall.

Make compensation values and employment state easy to scan.

## Components

Use Tailwind CSS and shadcn/ui.

Use only useful components such as button, input, select, badge, table, sheet, pagination, alert, skeleton, and tooltip. Do not create a large custom design system.

## Directory header

Show:

```text
Employees
Search and review compensation records
```

Show the visible employee count. Tell Scoped HR that results are permission filtered.

## Search

Use one search field:

```text
Search by name, employee ID, or exact email
```

Submit on Enter or Search. A short debounce is optional. Do not send one request for every key press. Keep search state in the URL.

## Filters

Filters:

- Department.
- Country.
- Currency.
- Level.
- Employment status.

Show desktop filters above the table. Show mobile filters in a sheet. Show active filters as removable chips and provide `Clear all`.

Use only values returned by the permission-filtered options endpoint.

## Sorting

Support:

- Employee name.
- Employee ID.
- Department.
- Country.
- Level.
- Hire date.
- Annual base salary.
- Annual cash compensation.

Show the current direction.

Salary sorting uses USD comparison. When active, show comparison currency, rate source, and effective date. Keep native compensation visible.

## Desktop table

Columns:

- Employee.
- Employee ID.
- Department and job title.
- Level.
- Country.
- Employment status.
- Native annual base salary.
- Native annual cash compensation.
- USD equivalent.

Link the employee name to detail. Use tabular numbers for money. Do not wrap one monetary value across lines.

## Mobile directory

Use summary cards or a reduced table instead of forcing the desktop table into a narrow screen.

Show name, employee ID, department, status, native annual base salary, and USD equivalent. Keep filters and pagination available.

## Compensation states

Use text labels:

```text
Current
Upcoming
Historical
```

Do not depend on color alone. For employees who left, use `Last recorded compensation`, not current spending.

## Pagination

Show current page, total pages, total matching employees, Previous, and Next. Disable unavailable actions. Keep search, filters, sort, and page in the URL.

## Employee detail

Show:

- Name and employee ID.
- Email.
- Department.
- Job title.
- Level.
- Country.
- Employment status.
- Hire date.
- End date when present.
- Current, upcoming, or historical compensation.
- Annual base salary.
- Annual bonus.
- Annual cash compensation.
- Native currency.
- USD equivalent.
- Rate source and date.
- Employee version.

Provide a clear return link. Preserve the previous directory query state.

## Compensation history

Show a timeline or table with effective date, version, change reason, annual base salary, annual bonus, annual cash compensation, and currency.

Show `Initial import` for the first entry. Show the newest relevant record first.

## Loading and empty states

Use page-specific skeletons. Do not show an editable search field that can lose text when loading finishes.

Differentiate:

```text
No employees match these filters.
```

from:

```text
Your HR account has no employee access.
```

Provide a clear recovery action.

## Error states

Handle API unavailable, invalid filters, expired session, unauthorized access, employee not found, missing exchange rate, and unexpected response.

Do not show stack traces or internal errors.

## Accessibility

- Every field has a visible label.
- Keyboard users can reach every action.
- Focus indicators remain visible.
- Table headers describe their columns.
- Status does not depend only on color.
- Dialogs and sheets manage focus.
- Loading changes use accessible status text.
- Respect reduced-motion settings.

## Tests

Test successful sign-in, incorrect password, HTTP-only cookie creation, protected-page redirect, Admin and Scoped HR scope display, search and filter URL state, salary-sort rate context, empty access, API failure, expired session, directory-detail-back state, mobile filters, and keyboard use.

## Excluded

- Dashboard analytics.
- Employee creation or editing.
- Salary adjustment.
- HR access-management pages.
- Spreadsheet upload.
- AI assistant.
- MCP.

## Frontend skill requirement

When frontend work starts, the builder must use:

- Original Anthropic frontend-design skill.
- Original Vercel React best-practices skill.
- Original Vercel web-design-guidelines skill.

The builder records repository URL, exact revision, files read, concrete UI effect, and concrete review correction. The builder must inspect the application in a real browser at desktop and mobile sizes.

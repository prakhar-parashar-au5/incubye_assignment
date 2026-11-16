# Compensation dashboard specification

## User and problem

The dashboard is for all HR users, including Admin HR and Scoped HR.

It must answer three questions:

- What is our current active employee count and annual compensation commitment, separated by currency?
- Where is compensation spending concentrated across departments, countries, levels, and currencies?
- What changed recently or needs action, including recent salary changes, pending approval requests, upcoming changes, and employees without a recent adjustment?

Every answer must respect the current HR user's access scope. Native currencies remain authoritative and must not be silently combined.

Within ten seconds, HR should understand active employee count, annual compensation spending, currencies, current scope, and items that need attention.

## Main dashboard journey

HR should:

1. Confirm which employee scope, date period, and currencies the dashboard represents.
2. Review active employee count, annual base salary, annual cash compensation, and upcoming compensation commitments.
3. Filter by department, country, currency, level, employment status, or date period.
4. Compare compensation spending across departments, countries, levels, and currencies.
5. Review recent salary changes, pending approval requests, upcoming changes, and employees without a recent adjustment.
6. Select a result to open the related employee, salary request, or filtered employee directory.

The dashboard is for understanding and navigation. It does not change salary directly. Salary changes and approvals happen in their dedicated workflows.

## Top figures

Show:

- Currently working employees.
- Soon-to-join employees.
- Employees who left.
- Annual base salary spending by native currency.
- Annual cash compensation by native currency.
- Upcoming approved compensation commitment.
- Recent recorded salary changes.
- Pending salary change requests.
- Employees without a recorded adjustment in 12 months.

Currently working employees are the primary headcount. Soon-to-join and left employees are shown separately.

Scoped HR sees only counts and amounts inside their current scope.

## Compensation spending

Current compensation spending includes only `CURRENTLY_WORKING` employees.

`SOON_TO_JOIN` employees appear in a separate future-commitment figure. Employees with status `LEFT` do not contribute to current or future spending.

INR and USD are always shown separately.

The dashboard can also show USD-equivalent comparison as secondary information. USD comparison is informational and is not authoritative compensation.

The exchange-rate source and effective date appear beside every USD-comparison section. Use an accessible information control that works with mouse, keyboard, touch, and screen readers. Do not make this information hover-only.

If the exchange rate is missing, hide or disable only USD comparison. Native totals remain available.

## Breakdowns

Required breakdowns:

- Department.
- Country.
- Currency.
- Level.
- Employment status.

For each breakdown, show where meaningful:

- Employee count.
- Annual base salary.
- Annual cash compensation.
- Average annual cash compensation.
- Median annual cash compensation.
- Minimum annual cash compensation.
- Maximum annual cash compensation.

Native currency groups remain separate. A median or average must not combine INR and USD without an explicit USD-comparison view.

Use tabs or one selected breakdown at a time. Do not place every breakdown and metric on the first screen.

## Recent salary changes

“Recent” means the compensation record was created recently. It does not mean the compensation became effective recently.

Default period is 30 days. HR can select 7, 30, or 90 days.

Exclude `INITIAL_IMPORT`.

Include a future-effective change when HR recorded it inside the selected period.

Each recent change shows:

- Employee name and employee ID.
- Department and country.
- Previous compensation.
- New compensation.
- Native currency.
- Change reason.
- Recorded time.
- Effective date.
- HR actor.
- Related salary request when applicable.

Each item links to employee detail. Admin HR can also open the related request.

If no recent changes exist, show:

```text
No compensation changes were recorded in this period.
```

## Employees without a recent adjustment

The default period is 12 months. HR can change the period.

Include only `CURRENTLY_WORKING` employees.

`INITIAL_IMPORT` does not count as a salary adjustment.

The source workbook contains current compensation only. The system cannot know salary history before import. Use this wording:

```text
No recorded salary adjustment since import or during the selected period.
```

Do not claim that the employee has never received an adjustment.

Show both:

- Total count.
- Paginated employee list.

The list links to employee detail.

## Pending and upcoming work

Show:

- Pending salary change requests.
- Requests that became stale.
- Approved salary changes with a future effective date.

Admin HR can open the full approval queue.

Scoped HR sees only requests for employees inside their current scope.

Dashboard counts do not approve, cancel, or apply changes.

## Filters

Global dashboard filters:

- Department.
- Country.
- Currency.
- Level.
- Employment status.
- Date period where the metric uses time.

Changing a global filter updates every compatible figure, breakdown, chart, and list.

If one metric does not support a selected filter, the UI must say so. It must not silently ignore the filter.

Keep filter state in the URL so the view can be shared and restored.

Only show filter options permitted for the current HR user.

## Charts and tables

Use charts only where visual comparison is faster than reading a table.

First version charts:

- Horizontal bar chart for annual cash compensation by department, separated by native currency or shown for one selected currency.
- Simple bar chart for employee count by employment status.

Use tables for:

- Exact department, country, currency, level, and status breakdown values.
- Recent salary changes.
- Pending requests.
- Employees without a recent adjustment.

Charts show exact values through accessible labels or tooltips. Tooltips must also work with keyboard focus.

On mobile, replace wide charts with a scroll-safe or stacked presentation. The page must not have horizontal overflow.

Do not use pie or donut charts in the first version.

## Permissions

Admin HR sees all employees, compensation aggregates, requests, and recent changes.

Scoped HR sees only employees and data inside:

```text
employee country IN assigned countries
AND
employee department IN assigned departments
```

Every count, total, average, median, chart, breakdown, request, and recent-change row must use the current scope.

An HR user with an empty country or department scope sees:

```text
Your HR account has no employee access.
```

The dashboard must not reveal hidden employee names, IDs, emails, salaries, counts, request counts, or filter options.

## Currency rules

Native currencies are never added together.

USD comparison is informational.

USD comparison uses the saved official exchange-rate snapshot. Show:

- Comparison currency.
- Rate.
- Quote direction.
- Source name.
- Source link.
- Effective date.

If a rate is missing, show native values and a clear message that USD comparison is unavailable.

Do not store converted salary on employee or compensation records.

## Page states

### Loading

Show stable page-specific skeletons and accessible loading text. Do not show final totals until the API confirms them.

### No employee access

Show the no-access message and tell the user to contact Admin HR.

### No data for filters

Show:

```text
No compensation data matches these filters.
```

Provide Clear filters.

### No recent changes

Show the approved empty message. Do not treat initial import as a change.

### Missing exchange rate

Keep native totals visible. Hide or disable USD comparison and explain why.

### Backend unavailable

Show a retry action. Keep the current session. Do not display stale totals as fresh data.

### Expired session

Clear the session cookie through the existing safe flow and redirect to sign-in.

### Invalid URL filters

Do not call the analytics API. Show a clear invalid-filter message and a Reset filters action.

## Tests I expect

### Aggregation and money

- Admin active headcount matches independent SQL.
- Scoped HR active headcount includes only permitted employees.
- Empty scope returns no employee aggregates.
- Current spending excludes `LEFT` and `SOON_TO_JOIN` employees.
- Future commitment includes eligible `SOON_TO_JOIN` and approved future compensation only.
- INR and USD totals remain separate.
- Annual cash compensation equals annual base salary plus annual bonus.
- Average uses exact decimal arithmetic and approved rounding.
- Median is correct for odd and even group sizes.
- Minimum and maximum remain inside one currency group.
- USD comparison uses the saved rate and states its source and date.
- Missing exchange rate leaves native totals available.

### Recent changes

- Default period is 30 days.
- Seven-day and 90-day periods use record creation time.
- `INITIAL_IMPORT` is excluded.
- A future-effective change recorded recently is included.
- An old record with a recent effective date is excluded.
- Scoped HR sees only permitted recent changes.
- Empty recent-change result returns the approved message.

### Employees without adjustment

- Default period is 12 months.
- Only currently working employees are included.
- Initial import does not count as an adjustment.
- Scoped HR sees only permitted employees.
- Result wording does not claim knowledge before import.
- Count and paginated list agree.

### Requests and future changes

- Admin pending request count includes all pending requests.
- Scoped HR request count uses current scope.
- Stale requests do not count as pending.
- Approved future changes appear in upcoming commitments.
- Selecting a count opens the correct filtered page.

### Filters and permissions

- Department, country, currency, level, and status filters update compatible metrics.
- Date period updates time-based metrics.
- Invalid and repeated filters are rejected.
- Filters cannot widen Scoped HR access.
- Filter options do not reveal hidden data.
- Unknown sort or group values do not enter SQL.

### API and database

- Aggregates execute in MySQL and do not load all employees into Node.js.
- SQL values are parameterized.
- Responses contain exact money strings.
- Responses contain no internal database IDs.
- OpenAPI matches runtime schemas.
- Logs contain no employee identity, salary, request-body, JWT, or SQL values.

### Frontend and browser

- Admin sees correct top figures and all permitted breakdowns.
- Scoped HR sees a visible scope notice and restricted figures.
- Empty scope shows the no-access state.
- Native currency separation is visible.
- USD rate context works with mouse, keyboard, touch, and screen reader.
- Filters update all compatible visible sections.
- Dashboard links preserve the selected filters.
- Loading, empty, missing-rate, invalid-filter, expired-session, and unavailable states render correctly.
- Desktop and mobile have no page-level horizontal overflow.
- Keyboard users can filter, inspect rate context, open detail, and sign out.
- Automated accessibility scan has no serious or critical findings.

## Performance

The dashboard must handle the current 10,000 employees.

Aggregates run in MySQL. Do not load the full employee data set into Node.js.

Measure:

- Top-figure query.
- Department breakdown.
- Country and currency breakdown.
- Median query.
- Recent changes.
- Employees without adjustment.
- Scoped versions of the same queries.

Record query plans and repeated local timings.

Do not add caching until measurement shows a need. If caching is added later, cache keys must include current HR scope and all filters.

## Deliberately excluded

- Custom report builder.
- User-defined dashboard widgets.
- Drag-and-drop layout.
- Live exchange-rate refresh.
- Predictive analytics.
- Pay-equity conclusions without an approved methodology.
- Payroll calculations.
- Tax calculations.
- Currency conversion for payroll or payment.
- Automatic salary recommendations.
- Direct salary mutation from the dashboard.

## Open questions

- None for the first dashboard version.

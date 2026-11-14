  ## Endpoints

  GET /api/v1/employees
  GET /api/v1/employees/:employeeCode
  GET /api/v1/employee-directory/options

  The options endpoint returns only filters available to the current HR user.

  Search

 ## search fields:

  - Employee ID.
  - First name.
  - Last name.
  - Full name.
  - Email address.

 ## behavior:

  - Employee ID supports exact and prefix search.
  - Names support case-insensitive partial search.
  - Email supports case-insensitive exact search.


 ## Filters 

  department
  country
  level
  employment status


  ## Sorting

  employee name
  employee ID
  department
  country
  level
  hire date
 
  Ascending and descending orders should both be supported.

  ## Pagination
  page = 1
  pageSize = 25

  Maximum: pageSize = 100

  This is sufficient for 10,000 employees and works well for an HR directory.


 ## Compensation shown in the directory

  annual base salary
  annual bonus
  annual cash compensation
  currency
  compensation state

  Annual cash compensation is:

  annual base salary + annual bonus . Do not combine currencies.

  
  ### Current, upcoming, and historical compensation

  The seeded data creates an important case.

  Currently working employee
  Show the latest compensation effective on or before today:
  state = CURRENT

  Soon-to-join employee
  The salary starts in the future:
  state = UPCOMING
  Show the earliest future compensation.

  Employee who left
  Show the last compensation record:
  state = HISTORICAL
  Do not label it as current spending.


  ## Employee detail

  detail response:

  - Employee identity.
  - Department.
  - Job title.
  - Level.
  - Country.
  - Employment status.
  - Hire and end dates.
  - Current, upcoming, or historical compensation.
  - Complete compensation history.
  - Employee version.

  The employee version will support stale-edit checks later.
  employee detail include full compensation history


  ## Permission behavior
   rules:

  - Admin HR sees all employees.
  - Scoped HR sees only matching country and department combinations.
  - Counts and filter options use the same scope.
  - An unknown employee returns 404.
  - An inaccessible employee returns the same 404.
  - Search does not reveal inaccessible names, emails, IDs, or counts.


  ## Empty and invalid pages

   behavior:

  - A valid page with no results returns an empty list.
  - A page beyond the final page returns an empty list with correct total metadata.
  - Invalid page numbers return HTTP 400.
  - Unknown sort fields return HTTP 400.
  - Page size above 100 returns HTTP 400.


  ## Performance

  The builder should:

  - Use SQL pagination.
  - Never load all employees into Node.js.
  - Use parameterized queries.
  - Allowlist SQL sort fields.
  - Add indexes from measured query plans.
  - Measure representative queries with 10,000 rows.
  - Avoid caching until measurements show a need.





  ## Cross-currency salary sorting

  Support these salary sort fields:
  - annual base salary
  - annual cash compensation

  USD is the comparison currency for the first version.
  Native compensation remains authoritative. The system must not store a converted salary value on the employee or compensation record.
  The backend uses a saved official exchange-rate snapshot. The snapshot stores the rate, source URL, effective date, and retrieval time.
  MySQL converts salary values inside the directory query before sorting and pagination. The application must not load all employees into Node.js for sorting.
  Use the full decimal conversion result for sorting. Round the USD equivalent to two decimal places only for display.

  Each directory row shows:
  - native compensation
  - native currency
  - USD equivalent
  - exchange-rate source
  - exchange-rate date

  If a required rate is missing, reject the salary sort. Do not fall back to sorting unconverted INR and USD values.
  Also add these query fields:
  sort = annualBaseSalary | annualCashCompensation
  comparisonCurrency = USD
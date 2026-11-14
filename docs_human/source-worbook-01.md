 # Source workbook design

  ## Purpose

  The workbook represents the source excel file to be used to seed our employees and salaries tables. It has the final updated data for every employee in the company till date. 

  ## Row meaning

  One row represents an employee

  ## Columns

  | Column | Required | Example | Reason |
  |---|---|---|---|
  | employee_id | Yes | ACME00001 | |
  | first_name | Yes | Aditi | |
  | last_name | Yes | Sharma | |
  | email | Yes | aditi.sharma.1@acme.com | |
  | department | Yes | Engineering | |
  | job_title | Yes | Backend Engineer | |
  | level | Yes | L3 | |
  | country_code | Yes | IN | |
  | currency | Yes | INR | |
  | employment_status | Yes | active | |
  | hire_date | Yes | 2022-08-14 | |
  | employment_end_date | No |  | |
  | base_salary | Yes | 1500000.00 | |
  | pay_frequency | Yes | annual | |
  | annual_bonus | Yes | 150000.00 | |
  | salary_effective_date | Yes | 2025-04-01 | |

  ## Allowed values

  Departments: Tech, HR, Finance, Operations, Support

  Levels: JUNIOR, MID, SENIOR_MANAGEMENT

  Countries: India, United States

  Currencies: INR, USD

  Employment statuses: SOON_TO_JOIN, CURRENTLY_WORKING, LEFT

  Pay frequencies: Monthly, Annually, One-time

  ## Rules

  - Employee IDs:
  Should follow the format ACME{5 DIGIT NUMBER}, EG - ACME00001, ACME00201 
  - Email addresses:
  first_name.last_name@acme.com, no persomal emails. 
  - Inactive employees:
   Should have not null employment_end_date, active employee should not have an employment_end_date
  - Salary:
  should be a positive integer, annual always, currency decides the actual value. 
  - Bonus: 
  Positive integer, value is for the current year only, should not exceed Rs 200000 or $2000 for junior employees, and Rs. 1000000 or $10000 for all employees
  - Dates:
 YYYY-MM-DD formats , always 
  - Currency and country: Currency can only take USD or IND, Country can only take India or USD

  ## Data generation

  The generated workbook will contain: 10000 ROWS

  ## Known limitation

  The source workbook does not contain compensation history. It only has final records so far. 
  Salary effective date be on or after the hire date 
  Annual bonus can be zero or positive value, it will be in the same currency as salary is 
  Monthly salary and annual bonus can exist together
  we need to generate unique email addresses, the script will first create names, randomly, and email address will be first_name.last_name@acme.com, if two employees have same first_name and last_name , second employees gets 1 appended to it's last_name when creating an email
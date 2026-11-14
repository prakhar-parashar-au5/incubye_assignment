# Initial database schema notes

## Why these tables exist

The workbook has employee details and current salary. We do not want to keep salary inside the employee table because one employee can have many salary records over time.

The first schema will have:

- countries
- departments
- job_titles
- employees
- compensation_records

HR users, access control, imports, and audit events can come in later migrations.

## countries

- `code` CHAR(2) primary key. Example: IN or US.
- `name` VARCHAR(100) not null unique.
- `currency` ENUM('INR', 'USD') not null.

One country has many employees.

## departments

- `id` SMALLINT UNSIGNED AUTO_INCREMENT primary key.
- `name` VARCHAR(100) not null unique.

One department has many job titles.

## job_titles

- `id` SMALLINT UNSIGNED AUTO_INCREMENT primary key.
- `department_id` SMALLINT UNSIGNED not null. Foreign key to departments(id).
- `name` VARCHAR(100) not null.
- `level` ENUM('JUNIOR', 'MID', 'SENIOR', 'LEAD', 'MANAGER') not null.
- The combination of department_id, name, and level must be unique.

A job title belongs to one department and one level. The employee gets department and level through the selected job title. This avoids a mismatch between employee department, title, and level.

## employees

- `id` INT UNSIGNED AUTO_INCREMENT primary key.
- `employee_code` CHAR(9) not null unique. Example: ACME00001.
- `first_name` VARCHAR(100) not null.
- `last_name` VARCHAR(100) not null.
- `email` VARCHAR(254) not null unique.
- `job_title_id` SMALLINT UNSIGNED not null. Foreign key to job_titles(id).
- `country_code` CHAR(2) not null. Foreign key to countries(code).
- `employment_status` ENUM('SOON_TO_JOIN', 'CURRENTLY_WORKING', 'LEFT') not null.
- `hire_date` DATE not null.
- `employment_end_date` DATE null.
- `version` INT UNSIGNED not null default 1. This will help prevent lost updates later.
- `created_at` DATETIME(3) not null.
- `updated_at` DATETIME(3) not null.

Employee email and employee code are unique.

An employee can change country or department later. A department change means selecting a job title from the new department.

A LEFT employee must have an employment end date. SOON_TO_JOIN and CURRENTLY_WORKING employees must not have an employment end date.

We do not hard-delete employees. LEFT employees keep their salary history.

## compensation_records

- `id` BIGINT UNSIGNED AUTO_INCREMENT primary key.
- `employee_id` INT UNSIGNED not null. Foreign key to employees(id).
- `version` INT UNSIGNED not null.
- `annual_base_salary` DECIMAL(15,2) not null.
- `annual_bonus` DECIMAL(15,2) not null default 0.00.
- `currency` ENUM('INR', 'USD') not null.
- `pay_frequency` ENUM('MONTHLY', 'ANNUAL') not null.
- `effective_from` DATE not null.
- `change_reason` ENUM('INITIAL_IMPORT', 'PERFORMANCE', 'MARKET_ADJUSTMENT', 'PROMOTION', 'ROLE_CHANGE', 'CORRECTION') not null.
- `created_at` DATETIME(3) not null.
- The combination of employee_id and version must be unique.
- Add an index on employee_id, effective_from, and version.

Annual base salary must be more than zero. Annual bonus can be zero but cannot be negative.

The workbook import creates compensation version 1 with change reason INITIAL_IMPORT.

Two compensation records can have the same effective date. The record with the higher version is the latest record for that date. This supports two approved changes on the same day without deleting history.

Current compensation is the latest record where effective_from is on or before the selected date. Sort by effective_from descending and version descending.

We store only annual_base_salary. We do not store monthly_salary because it is derived.

## Decisions

1. Use a separate compensation_records table: Yes.
2. Use an internal numeric id and public employee_code: Yes.
3. Employee emails are unique: Yes.
4. An employee can change country: Yes.
5. An employee can change department: Yes.
6. Two compensation records can have the same effective date: Yes. Higher version wins for that date.
7. Initial import creates compensation version 1: Yes.
8. LEFT employees keep salary history: Yes.
9. Salary and bonus use DECIMAL(15,2): Yes.
10. Controlled values use MySQL ENUM instead of VARCHAR plus CHECK: Yes.

## Relationships

- One country has many employees.
- One department has many job titles.
- One job title has many employees.
- One employee has many compensation records.

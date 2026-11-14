-- 001_initial_schema.sql
-- Initial schema from docs/05-initial-database-schema.md.
-- Forward-only: MySQL commits DDL implicitly, so fix mistakes with a new migration.
--
-- Character sets: codes are ASCII with binary collation (exact, case-sensitive
-- matching for keys and joins). Human text is utf8mb4 with the MySQL 8 default
-- case-insensitive collation, so "Tech" and "tech" count as duplicates.

CREATE TABLE countries (
  code     CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name     VARCHAR(100) NOT NULL,
  currency ENUM('INR', 'USD') NOT NULL,
  PRIMARY KEY (code),
  UNIQUE KEY uk_countries_name (name),
  CONSTRAINT chk_countries_code CHECK (REGEXP_LIKE(code, '^[A-Z]{2}$', 'c'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE departments (
  id   SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_departments_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE job_titles (
  id            SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  department_id SMALLINT UNSIGNED NOT NULL,
  name          VARCHAR(100) NOT NULL,
  level         ENUM('JUNIOR', 'MID', 'SENIOR', 'LEAD', 'MANAGER') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_job_titles_department_name_level (department_id, name, level),
  CONSTRAINT fk_job_titles_department FOREIGN KEY (department_id)
    REFERENCES departments (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Department and level are reached through job_title_id, so an employee cannot
-- hold an HR title in the Tech department. Current salary is not stored here.
CREATE TABLE employees (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_code       CHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_name          VARCHAR(100) NOT NULL,
  last_name           VARCHAR(100) NOT NULL,
  email               VARCHAR(254) NOT NULL,
  job_title_id        SMALLINT UNSIGNED NOT NULL,
  country_code        CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  employment_status   ENUM('SOON_TO_JOIN', 'CURRENTLY_WORKING', 'LEFT') NOT NULL,
  hire_date           DATE NOT NULL,
  employment_end_date DATE NULL,
  version             INT UNSIGNED NOT NULL DEFAULT 1,
  -- UTC: every application session sets time_zone = '+00:00'.
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_employees_employee_code (employee_code),
  UNIQUE KEY uk_employees_email (email),
  KEY idx_employees_job_title (job_title_id),
  KEY idx_employees_country (country_code),
  CONSTRAINT fk_employees_job_title FOREIGN KEY (job_title_id)
    REFERENCES job_titles (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_employees_country FOREIGN KEY (country_code)
    REFERENCES countries (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_employees_employee_code CHECK (REGEXP_LIKE(employee_code, '^ACME[0-9]{5}$', 'c')),
  CONSTRAINT chk_employees_first_name CHECK (CHAR_LENGTH(TRIM(first_name)) > 0),
  CONSTRAINT chk_employees_last_name CHECK (CHAR_LENGTH(TRIM(last_name)) > 0),
  CONSTRAINT chk_employees_end_date_status CHECK (
    (employment_status = 'LEFT' AND employment_end_date IS NOT NULL)
    OR (employment_status IN ('SOON_TO_JOIN', 'CURRENTLY_WORKING') AND employment_end_date IS NULL)
  ),
  CONSTRAINT chk_employees_end_after_hire CHECK (employment_end_date IS NULL OR employment_end_date > hire_date),
  CONSTRAINT chk_employees_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Immutable compensation history. annual_base_salary is authoritative; no
-- monthly value is stored. Currency is stored per record so an older record
-- keeps its currency if the employee later changes country.
-- DECIMAL(15,2) rounds a third decimal place instead of failing, so the
-- application must reject more than two decimal places before insert.
CREATE TABLE compensation_records (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id        INT UNSIGNED NOT NULL,
  version            INT UNSIGNED NOT NULL,
  annual_base_salary DECIMAL(15, 2) NOT NULL,
  annual_bonus       DECIMAL(15, 2) NOT NULL,
  currency           ENUM('INR', 'USD') NOT NULL,
  pay_frequency      ENUM('MONTHLY', 'ANNUAL') NOT NULL,
  effective_from     DATE NOT NULL,
  change_reason      ENUM('INITIAL_IMPORT', 'PERFORMANCE', 'MARKET_ADJUSTMENT', 'PROMOTION', 'ROLE_CHANGE', 'CORRECTION') NOT NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_compensation_employee_version (employee_id, version),
  -- Serves the as-of lookup: employee_id = ? AND effective_from <= ?
  -- ORDER BY effective_from DESC, version DESC LIMIT 1.
  KEY idx_compensation_employee_effective (employee_id, effective_from, version),
  CONSTRAINT fk_compensation_employee FOREIGN KEY (employee_id)
    REFERENCES employees (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_compensation_salary_positive CHECK (annual_base_salary > 0),
  CONSTRAINT chk_compensation_bonus_non_negative CHECK (annual_bonus >= 0),
  CONSTRAINT chk_compensation_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

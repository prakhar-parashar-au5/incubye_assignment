-- 003_salary_adjustments.sql
-- Salary bands, Scoped HR change requests, and actor/source columns on the
-- immutable compensation history (docs_human/11-salary-adjustments.md).
-- No separate compensation audit table: compensation_records plus
-- compensation_change_requests are the history.
-- Forward-only. All foreign keys RESTRICT.

-- Product policy: one band per job title, country, and currency. The initial
-- rows are inserted by the reference-data step of the seed (job titles do not
-- exist when migrations run), from the approved synthetic ranges.
CREATE TABLE salary_bands (
  id                      SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_title_id            SMALLINT UNSIGNED NOT NULL,
  country_code            CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency                ENUM('INR', 'USD') NOT NULL,
  min_annual_base_salary  DECIMAL(15, 2) NOT NULL,
  max_annual_base_salary  DECIMAL(15, 2) NOT NULL,
  max_annual_bonus        DECIMAL(15, 2) NOT NULL,
  min_percentage_increase SMALLINT UNSIGNED NOT NULL,
  max_percentage_increase SMALLINT UNSIGNED NOT NULL,
  min_percentage_decrease SMALLINT UNSIGNED NOT NULL,
  max_percentage_decrease SMALLINT UNSIGNED NOT NULL,
  created_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_salary_bands_title_country_currency (job_title_id, country_code, currency),
  CONSTRAINT fk_salary_bands_job_title FOREIGN KEY (job_title_id)
    REFERENCES job_titles (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_salary_bands_country FOREIGN KEY (country_code)
    REFERENCES countries (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_salary_bands_base_range CHECK (min_annual_base_salary > 0 AND max_annual_base_salary >= min_annual_base_salary),
  CONSTRAINT chk_salary_bands_bonus CHECK (max_annual_bonus >= 0),
  -- Product limits: increases 1..200 %, decreases 1..50 %. A band may narrow them.
  CONSTRAINT chk_salary_bands_increase CHECK (min_percentage_increase >= 1 AND max_percentage_increase <= 200
                                               AND min_percentage_increase <= max_percentage_increase),
  CONSTRAINT chk_salary_bands_decrease CHECK (min_percentage_decrease >= 1 AND max_percentage_decrease <= 50
                                               AND min_percentage_decrease <= max_percentage_decrease)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A Scoped HR request for one adjustment, decided by an Admin HR user.
-- public_id is the only identifier the API exposes.
-- Times are written by the application from one injected clock.
CREATE TABLE compensation_change_requests (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id                 CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  employee_id               INT UNSIGNED NOT NULL,
  requested_by_hr_user_id   INT UNSIGNED NOT NULL,
  adjustment_target         ENUM('BASE_SALARY', 'ANNUAL_BONUS') NOT NULL,
  adjustment_method         ENUM('PERCENTAGE_INCREASE', 'PERCENTAGE_DECREASE', 'FIXED_INCREASE', 'FIXED_DECREASE', 'REPLACEMENT') NOT NULL,
  -- A whole percentage or an amount, stored with two decimals.
  input_value               DECIMAL(15, 2) NOT NULL,
  currency                  ENUM('INR', 'USD') NOT NULL,
  previous_target_value     DECIMAL(15, 2) NOT NULL,
  proposed_target_value     DECIMAL(15, 2) NOT NULL,
  -- Highest compensation version when the request was made (the expected version).
  requested_against_version INT UNSIGNED NOT NULL,
  -- Version of the record the adjustment was calculated from.
  base_compensation_version INT UNSIGNED NOT NULL,
  effective_from            DATE NOT NULL,
  change_reason             ENUM('PERFORMANCE', 'MARKET_ADJUSTMENT', 'PROMOTION', 'ROLE_CHANGE', 'CORRECTION') NOT NULL,
  note                      VARCHAR(2000) NULL,
  status                    ENUM('PENDING', 'APPROVED', 'CANCELLED', 'STALE') NOT NULL DEFAULT 'PENDING',
  -- The Admin who approved or cancelled. NULL for PENDING and for STALE (set by the system).
  decided_by_hr_user_id     INT UNSIGNED NULL,
  decided_at                DATETIME(3) NULL,
  -- Cancellation note or stale reason.
  decision_note             VARCHAR(2000) NULL,
  request_idempotency_key   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decision_idempotency_key  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at                DATETIME(3) NOT NULL,
  updated_at                DATETIME(3) NOT NULL,
  -- employee_id while PENDING, otherwise NULL: the unique key allows one pending request per employee.
  pending_employee_id       INT UNSIGNED GENERATED ALWAYS AS (IF(status = 'PENDING', employee_id, NULL)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ccr_public_id (public_id),
  UNIQUE KEY uk_ccr_one_pending (pending_employee_id),
  UNIQUE KEY uk_ccr_request_key (requested_by_hr_user_id, request_idempotency_key),
  UNIQUE KEY uk_ccr_decision_key (decided_by_hr_user_id, decision_idempotency_key),
  KEY idx_ccr_employee_status (employee_id, status),
  KEY idx_ccr_status_created (status, created_at),
  CONSTRAINT fk_ccr_employee FOREIGN KEY (employee_id)
    REFERENCES employees (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ccr_requested_by FOREIGN KEY (requested_by_hr_user_id)
    REFERENCES hr_users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ccr_decided_by FOREIGN KEY (decided_by_hr_user_id)
    REFERENCES hr_users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_ccr_values CHECK (input_value >= 0 AND previous_target_value >= 0 AND proposed_target_value >= 0),
  CONSTRAINT chk_ccr_changes_value CHECK (proposed_target_value <> previous_target_value),
  CONSTRAINT chk_ccr_correction_note CHECK (change_reason <> 'CORRECTION' OR note IS NOT NULL),
  CONSTRAINT chk_ccr_decision CHECK (
    (status = 'PENDING' AND decided_by_hr_user_id IS NULL AND decided_at IS NULL
       AND decision_note IS NULL AND decision_idempotency_key IS NULL)
    OR (status = 'APPROVED' AND decided_by_hr_user_id IS NOT NULL AND decided_at IS NOT NULL
       AND decision_idempotency_key IS NOT NULL)
    OR (status = 'CANCELLED' AND decided_by_hr_user_id IS NOT NULL AND decided_at IS NOT NULL
       AND decision_idempotency_key IS NOT NULL AND decision_note IS NOT NULL)
    OR (status = 'STALE' AND decided_by_hr_user_id IS NULL AND decided_at IS NOT NULL
       AND decision_note IS NOT NULL AND decision_idempotency_key IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Approved additions to the immutable compensation history. All nullable:
-- INITIAL_IMPORT rows have no actor. For an approved request,
-- changed_by_hr_user_id is the approving Admin; the request keeps the requester.
ALTER TABLE compensation_records
  ADD COLUMN previous_compensation_record_id BIGINT UNSIGNED NULL,
  ADD COLUMN changed_by_hr_user_id INT UNSIGNED NULL,
  ADD COLUMN source_request_id BIGINT UNSIGNED NULL,
  ADD COLUMN change_note VARCHAR(2000) NULL,
  ADD COLUMN operation_idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Admin direct changes only: SHA-256 (hex) of the canonical command, so a
  -- reused idempotency key is compared by command, not by outcome
  -- (src/compensation/fingerprint.ts). Holds no amount, note, or token.
  ADD COLUMN operation_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY uk_compensation_operation_key (changed_by_hr_user_id, operation_idempotency_key),
  ADD UNIQUE KEY uk_compensation_source_request (source_request_id),
  ADD CONSTRAINT fk_compensation_previous FOREIGN KEY (previous_compensation_record_id)
    REFERENCES compensation_records (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compensation_changed_by FOREIGN KEY (changed_by_hr_user_id)
    REFERENCES hr_users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fk_compensation_source_request FOREIGN KEY (source_request_id)
    REFERENCES compensation_change_requests (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT chk_compensation_initial_import CHECK (
    change_reason <> 'INITIAL_IMPORT'
    OR (previous_compensation_record_id IS NULL AND changed_by_hr_user_id IS NULL
        AND source_request_id IS NULL AND operation_idempotency_key IS NULL AND operation_fingerprint IS NULL)
  ),
  ADD CONSTRAINT chk_compensation_fingerprint_format CHECK (
    operation_fingerprint IS NULL OR REGEXP_LIKE(operation_fingerprint, '^[0-9a-f]{64}$', 'c')
  ),
  -- An HR-written direct change (no source request) has a fingerprint; an
  -- approved request's record has none (its idempotency lives on the request).
  ADD CONSTRAINT chk_compensation_direct_fingerprint CHECK (
    changed_by_hr_user_id IS NULL
    OR (source_request_id IS NULL AND operation_fingerprint IS NOT NULL)
    OR (source_request_id IS NOT NULL AND operation_fingerprint IS NULL)
  ),
  -- Application-written corrections need a note. Rows without an actor are
  -- historical or test fixtures and are not constrained here.
  ADD CONSTRAINT chk_compensation_correction_note CHECK (
    change_reason <> 'CORRECTION' OR changed_by_hr_user_id IS NULL OR change_note IS NOT NULL
  );

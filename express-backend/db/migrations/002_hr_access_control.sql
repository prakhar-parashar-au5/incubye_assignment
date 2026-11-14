-- 002_hr_access_control.sql
-- HR users, scopes, sessions, and access audit from docs/10-access-control-design.md.
-- Forward-only. All foreign keys RESTRICT: HR users are deactivated, never
-- deleted, so sessions, scopes, and audit history stay attached.

CREATE TABLE hr_users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Case-insensitive collation: Meera@acme.com and meera@acme.com are one account.
  email         VARCHAR(254) NOT NULL,
  display_name  VARCHAR(100) NOT NULL,
  -- Argon2id PHC string only; the database refuses anything that looks like plain text.
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role          ENUM('ADMIN', 'SCOPED') NOT NULL,
  status        ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  version       INT UNSIGNED NOT NULL DEFAULT 1,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_hr_users_email (email),
  CONSTRAINT chk_hr_users_password_hash CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT chk_hr_users_display_name CHECK (CHAR_LENGTH(TRIM(display_name)) > 0),
  CONSTRAINT chk_hr_users_version CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Scope rule: employee country IN countries AND employee department IN departments.
-- No rows in either table means no employee access for a SCOPED user.
CREATE TABLE hr_user_country_scopes (
  hr_user_id   INT UNSIGNED NOT NULL,
  country_code CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (hr_user_id, country_code),
  KEY idx_hr_country_scopes_country (country_code),
  CONSTRAINT fk_hr_country_scopes_user FOREIGN KEY (hr_user_id)
    REFERENCES hr_users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_hr_country_scopes_country FOREIGN KEY (country_code)
    REFERENCES countries (code) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE hr_user_department_scopes (
  hr_user_id    INT UNSIGNED NOT NULL,
  department_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (hr_user_id, department_id),
  KEY idx_hr_department_scopes_department (department_id),
  CONSTRAINT fk_hr_department_scopes_user FOREIGN KEY (hr_user_id)
    REFERENCES hr_users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_hr_department_scopes_department FOREIGN KEY (department_id)
    REFERENCES departments (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per sign-in. id is a random UUID carried in the JWT "sid" claim.
-- Times are UTC and written by the application from one clock, so tests can
-- inject time; created_at has no default for the same reason.
CREATE TABLE hr_sessions (
  id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  hr_user_id INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_hr_sessions_user (hr_user_id),
  CONSTRAINT fk_hr_sessions_user FOREIGN KEY (hr_user_id)
    REFERENCES hr_users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_hr_sessions_expiry CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Append-only access history. actor_hr_user_id is NULL only for system
-- actions (the documented demo-user setup), never for an HR request.
-- States hold role, status, countries, and departments only: never passwords,
-- password hashes, JWTs, or session IDs.
CREATE TABLE access_audit_events (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_hr_user_id  INT UNSIGNED NULL,
  target_hr_user_id INT UNSIGNED NOT NULL,
  action            ENUM('HR_USER_CREATED', 'COUNTRY_SCOPES_CHANGED', 'DEPARTMENT_SCOPES_CHANGED',
                         'HR_USER_ACTIVATED', 'HR_USER_DEACTIVATED') NOT NULL,
  before_state      JSON NULL,
  after_state       JSON NOT NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_access_audit_target (target_hr_user_id, created_at),
  KEY idx_access_audit_actor (actor_hr_user_id, created_at),
  CONSTRAINT fk_access_audit_actor FOREIGN KEY (actor_hr_user_id)
    REFERENCES hr_users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_access_audit_target FOREIGN KEY (target_hr_user_id)
    REFERENCES hr_users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

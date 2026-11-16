-- 004_hr_access_management.sql
-- Admin HR access management (docs_human/12-hr-access-management.md).
-- Extends the existing immutable access_audit_events; no second audit table.
-- Forward-only.

ALTER TABLE access_audit_events
  -- New actions. The existing values stay valid for history already written.
  MODIFY COLUMN action ENUM('HR_USER_CREATED', 'COUNTRY_SCOPES_CHANGED', 'DEPARTMENT_SCOPES_CHANGED',
                            'HR_USER_ACTIVATED', 'HR_USER_DEACTIVATED',
                            'DISPLAY_NAME_CHANGED', 'SCOPES_REPLACED', 'HR_USER_PROMOTED') NOT NULL,
  -- Admin-entered reason (deactivation and reactivation). Never a password,
  -- hash, JWT, session ID, cookie, or authorization header.
  ADD COLUMN reason VARCHAR(2000) NULL,
  -- hr_users.version after the change. NULL only for events written before
  -- this migration, other than creations (backfilled below).
  ADD COLUMN resulting_version INT UNSIGNED NULL,
  -- How many active sessions the change revoked (promotion, deactivation). A count only.
  ADD COLUMN revoked_session_count INT UNSIGNED NULL,
  -- Access-management API writes only: the actor's Idempotency-Key and the
  -- SHA-256 (hex) of the canonical command (src/access/access-command.ts), so a
  -- reused key is compared by command. Both NULL for system and older writes.
  ADD COLUMN operation_idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN operation_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY uk_access_audit_operation_key (actor_hr_user_id, operation_idempotency_key),
  ADD CONSTRAINT chk_access_audit_operation CHECK ((operation_idempotency_key IS NULL) = (operation_fingerprint IS NULL)),
  ADD CONSTRAINT chk_access_audit_operation_actor CHECK (operation_idempotency_key IS NULL OR actor_hr_user_id IS NOT NULL),
  ADD CONSTRAINT chk_access_audit_fingerprint_format CHECK (
    operation_fingerprint IS NULL OR REGEXP_LIKE(operation_fingerprint, '^[0-9a-f]{64}$', 'c')
  ),
  ADD CONSTRAINT chk_access_audit_reason CHECK (reason IS NULL OR CHAR_LENGTH(TRIM(reason)) > 0),
  -- An API status change always carries its reason.
  ADD CONSTRAINT chk_access_audit_status_reason CHECK (
    operation_idempotency_key IS NULL OR action NOT IN ('HR_USER_ACTIVATED', 'HR_USER_DEACTIVATED') OR reason IS NOT NULL
  );

-- A creation always produces version 1. Other older events keep NULL
-- ("not recorded") rather than a guessed version.
UPDATE access_audit_events SET resulting_version = 1 WHERE action = 'HR_USER_CREATED';

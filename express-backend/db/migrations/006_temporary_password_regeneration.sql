-- 006_temporary_password_regeneration.sql
-- Review fix 11a: Admin HR can regenerate a temporary password, so a lost
-- creation (or regeneration) response never strands an unusable account.
-- Extends the existing immutable access_audit_events; no new table.
-- Forward-only.

ALTER TABLE access_audit_events
  MODIFY COLUMN action ENUM('HR_USER_CREATED', 'COUNTRY_SCOPES_CHANGED', 'DEPARTMENT_SCOPES_CHANGED',
                            'HR_USER_ACTIVATED', 'HR_USER_DEACTIVATED',
                            'DISPLAY_NAME_CHANGED', 'SCOPES_REPLACED', 'HR_USER_PROMOTED',
                            'TEMPORARY_PASSWORD_REGENERATED') NOT NULL;

-- A regeneration always records why, and how many sessions it revoked.
-- The event never holds the password or its hash: states carry access fields only.
ALTER TABLE access_audit_events
  ADD CONSTRAINT chk_access_audit_regeneration CHECK (
    action <> 'TEMPORARY_PASSWORD_REGENERATED' OR (reason IS NOT NULL AND revoked_session_count IS NOT NULL AND resulting_version IS NOT NULL)
  );

-- 007_ai_trace_actor_scope.sql
-- AI Task 03a (Option C): the actor's authorization at trace time, so a saved
-- answer is shown again only while the current scope still covers it.
-- Role plus sorted country codes and department names. No session ID, and no
-- second authorization model: these columns are evidence, not grants.
-- NULL on every column means a trace recorded before this migration; the
-- application treats it as uncovered for Scoped HR (fail closed).
-- Forward-only.

ALTER TABLE ai_traces
  ADD COLUMN actor_role ENUM('ADMIN','SCOPED') NULL AFTER hr_user_id,
  ADD COLUMN actor_countries JSON NULL AFTER actor_role,
  ADD COLUMN actor_departments JSON NULL AFTER actor_countries,
  ADD CONSTRAINT chk_ai_traces_actor_scope CHECK (
    (actor_role IS NULL AND actor_countries IS NULL AND actor_departments IS NULL)
    OR (actor_role IS NOT NULL AND actor_countries IS NOT NULL AND actor_departments IS NOT NULL
        AND JSON_TYPE(actor_countries) = 'ARRAY' AND JSON_TYPE(actor_departments) = 'ARRAY')
  );

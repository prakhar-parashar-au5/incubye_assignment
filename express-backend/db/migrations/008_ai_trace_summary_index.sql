-- 008_ai_trace_summary_index.sql
-- AI Task 04: the Admin monitoring summary reads every trace started in a
-- window of up to 30 days. With 10,000 traces over 90 days, EXPLAIN showed
-- the 30-day status count using a full index scan and the duration
-- percentiles using a full table scan (type ALL). This covering index lets
-- the status, failure, duration, token, and time-series aggregates read a
-- range of one narrow index instead of the table.
-- Forward-only. See builder_docs/ai-builder/responses/04-mcp-and-admin-observability-api.md.

ALTER TABLE ai_traces
  ADD KEY idx_ai_traces_summary (started_at, status, duration_ms, failure_stage, error_category, input_tokens, output_tokens, reasoning_tokens);

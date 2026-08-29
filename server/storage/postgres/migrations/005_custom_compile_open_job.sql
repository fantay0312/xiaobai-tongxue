DROP INDEX IF EXISTS custom_compile_jobs_one_active_per_course_idx;

CREATE UNIQUE INDEX custom_compile_jobs_one_active_per_course_idx
  ON custom_compile_jobs (course_id)
  WHERE status IN ('queued', 'running', 'needs_review');

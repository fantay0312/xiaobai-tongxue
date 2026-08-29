ALTER TABLE custom_compile_jobs
  ADD COLUMN lease_token UUID,
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD CONSTRAINT custom_compile_jobs_lease_pair_chk
    CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL));

CREATE INDEX custom_compile_jobs_expired_lease_idx
  ON custom_compile_jobs (lease_expires_at)
  WHERE status = 'running';

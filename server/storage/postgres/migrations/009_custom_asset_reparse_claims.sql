ALTER TABLE custom_assets
  ADD COLUMN IF NOT EXISTS reparse_token UUID,
  ADD COLUMN IF NOT EXISTS reparse_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE custom_assets
  DROP CONSTRAINT IF EXISTS custom_assets_reparse_claim_pair;

ALTER TABLE custom_assets
  ADD CONSTRAINT custom_assets_reparse_claim_pair
  CHECK ((reparse_token IS NULL) = (reparse_started_at IS NULL));

CREATE INDEX IF NOT EXISTS custom_assets_reparse_claim_idx
  ON custom_assets (reparse_started_at)
  WHERE reparse_token IS NOT NULL;

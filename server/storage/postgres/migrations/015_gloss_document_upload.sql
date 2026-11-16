CREATE TABLE IF NOT EXISTS reader_gloss_upload_parts (
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id VARCHAR(160) NOT NULL,
  upload_id VARCHAR(64) NOT NULL,
  part_index INTEGER NOT NULL CHECK (part_index >= 0 AND part_index < 64),
  parts INTEGER NOT NULL CHECK (parts BETWEEN 1 AND 64),
  total_bytes INTEGER NOT NULL CHECK (total_bytes BETWEEN 1 AND 33554432),
  chunk BYTEA NOT NULL CHECK (octet_length(chunk) BETWEEN 1 AND 524288),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
  PRIMARY KEY (owner_id, article_id, upload_id, part_index)
);
CREATE INDEX IF NOT EXISTS reader_gloss_upload_expiry ON reader_gloss_upload_parts(expires_at);

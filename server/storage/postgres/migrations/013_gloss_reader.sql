CREATE TABLE IF NOT EXISTS reader_gloss_entities (
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection VARCHAR(16) NOT NULL,
  id VARCHAR(160) NOT NULL,
  article_id VARCHAR(160) NOT NULL,
  data JSONB,
  doc JSONB,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(owner_id, collection, id)
);
CREATE INDEX IF NOT EXISTS reader_gloss_updates ON reader_gloss_entities(owner_id, updated_at);
CREATE TABLE IF NOT EXISTS reader_gloss_covers (
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id VARCHAR(160) NOT NULL,
  image BYTEA NOT NULL,
  content_type VARCHAR(40) NOT NULL,
  PRIMARY KEY(owner_id, id)
);

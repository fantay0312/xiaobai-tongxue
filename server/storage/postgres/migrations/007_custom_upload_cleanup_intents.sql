CREATE TABLE custom_asset_upload_intents (
  id UUID PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES custom_courses(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cos_key TEXT NOT NULL UNIQUE,
  wk_knowledge_id VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX custom_asset_upload_intents_stale_idx
  ON custom_asset_upload_intents (created_at);

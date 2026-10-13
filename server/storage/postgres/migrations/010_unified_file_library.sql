CREATE TABLE IF NOT EXISTS file_libraries (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  catalog JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(catalog) = 'array'),
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

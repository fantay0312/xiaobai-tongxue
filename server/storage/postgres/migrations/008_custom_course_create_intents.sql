CREATE TABLE custom_course_create_intents (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  wk_doc_kb_id UUID NOT NULL UNIQUE,
  wk_faq_kb_id UUID NOT NULL UNIQUE,
  cleanup_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX custom_course_create_intents_stale_idx
  ON custom_course_create_intents (created_at);

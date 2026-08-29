CREATE TABLE IF NOT EXISTS custom_courses (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  wk_doc_kb_id VARCHAR(80) NOT NULL UNIQUE,
  wk_faq_kb_id VARCHAR(80) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custom_courses_owner_created_idx
  ON custom_courses (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS custom_assets (
  id UUID PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES custom_courses(id) ON DELETE CASCADE,
  asset_role VARCHAR(24) NOT NULL
    CHECK (asset_role IN ('lecture', 'lab', 'syllabus', 'reading')),
  filename VARCHAR(260) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  sha256 CHAR(64) NOT NULL,
  cos_key TEXT NOT NULL UNIQUE,
  wk_knowledge_id VARCHAR(80) NOT NULL UNIQUE,
  parse_status VARCHAR(24) NOT NULL
    CHECK (parse_status IN ('pending', 'processing', 'finalizing', 'completed', 'failed', 'deleting', 'cancelled')),
  enable_status VARCHAR(24) NOT NULL DEFAULT 'disabled',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id, sha256)
);

CREATE INDEX IF NOT EXISTS custom_assets_course_created_idx
  ON custom_assets (course_id, created_at DESC);

CREATE TABLE IF NOT EXISTS custom_topics (
  id UUID PRIMARY KEY,
  topic_id VARCHAR(160) NOT NULL UNIQUE,
  course_id UUID NOT NULL REFERENCES custom_courses(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL
    CHECK (status IN ('draft', 'ready', 'archived')),
  payload JSONB NOT NULL,
  quality_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_version VARCHAR(40) NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custom_topics_course_status_idx
  ON custom_topics (course_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS custom_compile_jobs (
  id UUID PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES custom_courses(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES custom_topics(id) ON DELETE SET NULL,
  asset_ids UUID[] NOT NULL,
  requested_title VARCHAR(160),
  status VARCHAR(24) NOT NULL
    CHECK (status IN ('queued', 'running', 'needs_review', 'done', 'failed')),
  error_code VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custom_compile_jobs_course_created_idx
  ON custom_compile_jobs (course_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS custom_compile_jobs_one_active_per_course_idx
  ON custom_compile_jobs (course_id)
  WHERE status IN ('queued', 'running');

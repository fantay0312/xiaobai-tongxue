CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  source VARCHAR(16) NOT NULL DEFAULT 'registered'
    CHECK (source IN ('configured', 'registered')),
  username VARCHAR(80) NOT NULL,
  username_normalized VARCHAR(80) NOT NULL UNIQUE,
  display_name VARCHAR(120),
  password_hash TEXT,
  password_salt TEXT,
  password_scheme VARCHAR(40),
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version > 0),
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (password_hash IS NULL AND password_salt IS NULL AND password_scheme IS NULL)
    OR
    (password_hash IS NOT NULL AND password_salt IS NOT NULL AND password_scheme IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('email', 'phone')),
  lookup_hash CHAR(64) NOT NULL,
  ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL CHECK (OCTET_LENGTH(nonce) = 12),
  auth_tag BYTEA NOT NULL CHECK (OCTET_LENGTH(auth_tag) = 16),
  verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind),
  UNIQUE (kind, lookup_hash)
);

CREATE INDEX IF NOT EXISTS contacts_user_id_idx ON contacts(user_id);

CREATE TABLE IF NOT EXISTS learning_states (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_key VARCHAR(120) NOT NULL,
  state JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, state_key)
);

CREATE TABLE IF NOT EXISTS inbound_emails (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_message_id VARCHAR(255) NOT NULL UNIQUE,
  from_address TEXT NOT NULL,
  to_addresses TEXT[] NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT,
  html_body TEXT,
  headers JSONB NOT NULL DEFAULT '{}'::JSONB,
  received_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inbound_emails_user_received_idx
  ON inbound_emails(user_id, received_at DESC);

CREATE TABLE IF NOT EXISTS user_files (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inbound_email_id UUID REFERENCES inbound_emails(id) ON DELETE SET NULL,
  purpose VARCHAR(40) NOT NULL CHECK (purpose IN ('transcript', 'email_attachment')),
  cos_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_files_user_created_idx
  ON user_files(user_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS user_files_inbound_email_idx
  ON user_files(inbound_email_id) WHERE inbound_email_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  outcome VARCHAR(40) NOT NULL,
  actor_hash CHAR(64),
  ip_hash CHAR(64),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_audit_events_user_time_idx
  ON auth_audit_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_events_action_time_idx
  ON auth_audit_events(action, occurred_at DESC);

CREATE TABLE IF NOT EXISTS admin_accounts (
  id UUID PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  email_normalized VARCHAR(254) NOT NULL UNIQUE,
  display_name VARCHAR(120),
  password_hash TEXT,
  password_salt TEXT,
  password_scheme VARCHAR(40),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended')),
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version > 0),
  activated_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (password_hash IS NULL AND password_salt IS NULL AND password_scheme IS NULL)
    OR
    (password_hash IS NOT NULL AND password_salt IS NOT NULL AND password_scheme IS NOT NULL)
  ),
  CHECK (status <> 'active' OR password_hash IS NOT NULL),
  CHECK (NOT is_owner OR status <> 'suspended')
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_single_owner_idx
  ON admin_accounts (is_owner) WHERE is_owner;

CREATE OR REPLACE FUNCTION protect_admin_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_owner THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'admin-owner-protected' USING ERRCODE = '23514';
    END IF;
    IF NEW.is_owner = FALSE
      OR NEW.email <> OLD.email
      OR NEW.email_normalized <> OLD.email_normalized
      OR NEW.status = 'suspended'
      OR (OLD.status = 'active' AND NEW.status <> 'active') THEN
      RAISE EXCEPTION 'admin-owner-protected' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_accounts_owner_guard ON admin_accounts;
CREATE TRIGGER admin_accounts_owner_guard
BEFORE UPDATE OR DELETE ON admin_accounts
FOR EACH ROW EXECUTE FUNCTION protect_admin_owner();

CREATE TABLE IF NOT EXISTS admin_permissions (
  id UUID PRIMARY KEY,
  permission_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_roles (
  id UUID PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES admin_permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS admin_account_roles (
  account_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES admin_roles(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, role_id)
);

CREATE INDEX IF NOT EXISTS admin_account_roles_role_idx
  ON admin_account_roles(role_id);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_hash CHAR(64) NOT NULL,
  session_version INTEGER NOT NULL CHECK (session_version > 0),
  ip_hash CHAR(64),
  user_agent_hash CHAR(64),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_sessions_account_active_idx
  ON admin_sessions(account_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_invitations (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_invitations_account_active_idx
  ON admin_invitations(account_id, expires_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

WITH ranked_active_invitations AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY account_id ORDER BY created_at DESC, id DESC
  ) AS active_rank
  FROM admin_invitations
  WHERE consumed_at IS NULL AND revoked_at IS NULL
)
UPDATE admin_invitations
SET revoked_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_active_invitations WHERE active_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_invitations_one_active_per_account_idx
  ON admin_invitations(account_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id UUID PRIMARY KEY,
  actor_account_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(80),
  target_id VARCHAR(160),
  outcome VARCHAR(32) NOT NULL,
  request_id VARCHAR(80) NOT NULL,
  ip_hash CHAR(64),
  user_agent_hash CHAR(64),
  before_state JSONB,
  after_state JSONB,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_events_time_idx
  ON admin_audit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_actor_time_idx
  ON admin_audit_events(actor_account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_target_time_idx
  ON admin_audit_events(target_type, target_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION protect_admin_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin-audit-immutable' USING ERRCODE = '23514';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_events_immutable_guard ON admin_audit_events;
CREATE TRIGGER admin_audit_events_immutable_guard
BEFORE UPDATE OR DELETE ON admin_audit_events
FOR EACH ROW EXECUTE FUNCTION protect_admin_audit_event();

CREATE TABLE IF NOT EXISTS entitlement_definitions (
  id UUID PRIMARY KEY,
  entitlement_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  value_type VARCHAR(16) NOT NULL
    CHECK (value_type IN ('boolean', 'integer', 'string', 'json')),
  default_value JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  current_version_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_plan_versions (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  name VARCHAR(120) NOT NULL,
  tagline VARCHAR(240) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, version_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_current_version_fk'
  ) THEN
    ALTER TABLE subscription_plans
      ADD CONSTRAINT subscription_plans_current_version_fk
      FOREIGN KEY (current_version_id)
      REFERENCES subscription_plan_versions(id)
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS subscription_prices (
  id UUID PRIMARY KEY,
  plan_version_id UUID NOT NULL REFERENCES subscription_plan_versions(id) ON DELETE CASCADE,
  billing_period VARCHAR(20) NOT NULL
    CHECK (billing_period IN ('free', 'monthly', 'quarterly', 'yearly', 'lifetime', 'custom')),
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  duration_days INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
  bonus_points BIGINT NOT NULL DEFAULT 0 CHECK (bonus_points >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_version_id, billing_period, currency)
);

CREATE TABLE IF NOT EXISTS plan_entitlements (
  plan_version_id UUID NOT NULL REFERENCES subscription_plan_versions(id) ON DELETE CASCADE,
  entitlement_id UUID NOT NULL REFERENCES entitlement_definitions(id) ON DELETE RESTRICT,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_version_id, entitlement_id)
);

CREATE OR REPLACE FUNCTION protect_published_plan_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published-plan-version-immutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS subscription_plan_versions_immutable_guard
  ON subscription_plan_versions;
CREATE TRIGGER subscription_plan_versions_immutable_guard
BEFORE UPDATE OR DELETE ON subscription_plan_versions
FOR EACH ROW EXECUTE FUNCTION protect_published_plan_version();

CREATE OR REPLACE FUNCTION protect_published_plan_details()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_version UUID;
  new_version UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_version := OLD.plan_version_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_version := NEW.plan_version_id;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM subscription_plan_versions
    WHERE id IN (old_version, new_version) AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'published-plan-details-immutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS subscription_prices_immutable_guard ON subscription_prices;
CREATE TRIGGER subscription_prices_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON subscription_prices
FOR EACH ROW EXECUTE FUNCTION protect_published_plan_details();

DROP TRIGGER IF EXISTS plan_entitlements_immutable_guard ON plan_entitlements;
CREATE TRIGGER plan_entitlements_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON plan_entitlements
FOR EACH ROW EXECUTE FUNCTION protect_published_plan_details();

CREATE TABLE IF NOT EXISTS commerce_features (
  id UUID PRIMARY KEY,
  feature_key VARCHAR(100) NOT NULL UNIQUE
    CHECK (feature_key IN (
      'login', 'chat', 'asr', 'vision', 'state', 'transcript', 'commerce'
    )),
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  required_entitlement_id UUID REFERENCES entitlement_definitions(id) ON DELETE SET NULL,
  public_reason TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO commerce_features (id, feature_key, name, description, enabled)
VALUES
  ('50000000-0000-4000-8000-000000000001', 'login', '账号登录', '控制用户登录与会话签发', TRUE),
  ('50000000-0000-4000-8000-000000000002', 'chat', 'AI 对话', '控制文字对话能力', TRUE),
  ('50000000-0000-4000-8000-000000000003', 'asr', '语音识别', '控制语音识别能力', TRUE),
  ('50000000-0000-4000-8000-000000000004', 'vision', '图像识别', '控制图像识别能力', TRUE),
  ('50000000-0000-4000-8000-000000000005', 'state', '学习状态', '控制学习状态读写', TRUE),
  ('50000000-0000-4000-8000-000000000006', 'transcript', '课堂转写', '控制课堂转写能力', TRUE),
  ('50000000-0000-4000-8000-000000000007', 'commerce', '订阅与兑换', '控制商业中心与 CDK 兑换', TRUE)
ON CONFLICT (feature_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  plan_version_id UUID NOT NULL REFERENCES subscription_plan_versions(id) ON DELETE RESTRICT,
  price_id UUID REFERENCES subscription_prices(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired', 'revoked')),
  source VARCHAR(20) NOT NULL
    CHECK (source IN ('admin', 'cdk', 'payment', 'system')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  snapshot JSONB NOT NULL,
  assigned_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS user_subscriptions_user_time_idx
  ON user_subscriptions(user_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS user_subscriptions_active_idx
  ON user_subscriptions(user_id, ends_at)
  WHERE status IN ('trialing', 'active');

CREATE TABLE IF NOT EXISTS user_subscription_entitlements (
  subscription_id UUID NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
  entitlement_key VARCHAR(100) NOT NULL,
  name VARCHAR(120) NOT NULL,
  value_type VARCHAR(16) NOT NULL
    CHECK (value_type IN ('boolean', 'integer', 'string', 'json')),
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subscription_id, entitlement_key)
);

CREATE TABLE IF NOT EXISTS user_entitlement_grants (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entitlement_key VARCHAR(100) NOT NULL,
  name VARCHAR(120) NOT NULL,
  value_type VARCHAR(16) NOT NULL
    CHECK (value_type IN ('boolean', 'integer', 'string', 'json')),
  value JSONB NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('admin', 'cdk', 'system')),
  source_reference VARCHAR(160),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  granted_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS user_entitlement_grants_active_idx
  ON user_entitlement_grants(user_id, entitlement_key, expires_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION protect_referenced_entitlement_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.value_type <> OLD.value_type AND (
    EXISTS (
      SELECT 1 FROM plan_entitlements
      WHERE entitlement_id = OLD.id
    )
    OR EXISTS (
      SELECT 1 FROM commerce_features
      WHERE required_entitlement_id = OLD.id
    )
    OR EXISTS (
      SELECT 1 FROM user_subscription_entitlements
      WHERE entitlement_key = OLD.entitlement_key
    )
    OR EXISTS (
      SELECT 1 FROM user_entitlement_grants
      WHERE entitlement_key = OLD.entitlement_key
    )
  ) THEN
    RAISE EXCEPTION 'entitlement-type-in-use' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entitlement_definitions_type_guard ON entitlement_definitions;
CREATE TRIGGER entitlement_definitions_type_guard
BEFORE UPDATE OF value_type ON entitlement_definitions
FOR EACH ROW EXECUTE FUNCTION protect_referenced_entitlement_type();

CREATE TABLE IF NOT EXISTS user_restrictions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scope VARCHAR(32) NOT NULL
    CHECK (scope IN ('all', 'login', 'chat', 'asr', 'vision', 'state', 'transcript', 'commerce')),
  reason TEXT NOT NULL,
  public_reason TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  revoked_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS user_restrictions_active_idx
  ON user_restrictions(user_id, scope, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS point_wallets (
  id UUID PRIMARY KEY,
  owner_type VARCHAR(16) NOT NULL CHECK (owner_type IN ('user', 'system')),
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  system_code VARCHAR(80),
  available BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (owner_type = 'user' AND user_id IS NOT NULL AND system_code IS NULL AND available >= 0)
    OR
    (owner_type = 'system' AND user_id IS NULL AND system_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS point_wallets_user_idx
  ON point_wallets(user_id) WHERE owner_type = 'user';
CREATE UNIQUE INDEX IF NOT EXISTS point_wallets_system_idx
  ON point_wallets(system_code) WHERE owner_type = 'system';

CREATE TABLE IF NOT EXISTS point_operations (
  id UUID PRIMARY KEY,
  operation_kind VARCHAR(32) NOT NULL
    CHECK (operation_kind IN ('admin_adjustment', 'cdk_redeem', 'subscription_bonus', 'consumption', 'refund', 'expiry')),
  status VARCHAR(16) NOT NULL DEFAULT 'posted'
    CHECK (status IN ('posted', 'reversed')),
  idempotency_key VARCHAR(160) NOT NULL UNIQUE,
  request_hash CHAR(64) NOT NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  actor_admin_id UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  reversed_by UUID REFERENCES point_operations(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS point_operations_user_time_idx
  ON point_operations(target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS point_postings (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL REFERENCES point_operations(id) ON DELETE RESTRICT,
  wallet_id UUID NOT NULL REFERENCES point_wallets(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL CHECK (amount <> 0),
  balance_after BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operation_id, wallet_id)
);

CREATE INDEX IF NOT EXISTS point_postings_wallet_time_idx
  ON point_postings(wallet_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_posted_point_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'posted-point-ledger-immutable' USING ERRCODE = '23514';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS point_operations_immutable_guard ON point_operations;
CREATE TRIGGER point_operations_immutable_guard
BEFORE UPDATE OR DELETE ON point_operations
FOR EACH ROW EXECUTE FUNCTION protect_posted_point_ledger();

DROP TRIGGER IF EXISTS point_postings_immutable_guard ON point_postings;
CREATE TRIGGER point_postings_immutable_guard
BEFORE UPDATE OR DELETE ON point_postings
FOR EACH ROW EXECUTE FUNCTION protect_posted_point_ledger();

CREATE OR REPLACE FUNCTION assert_point_operation_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  operation_uuid UUID;
  total BIGINT;
BEGIN
  operation_uuid := COALESCE(NEW.operation_id, OLD.operation_id);
  SELECT COALESCE(SUM(amount), 0) INTO total
  FROM point_postings
  WHERE operation_id = operation_uuid;
  IF total <> 0 THEN
    RAISE EXCEPTION 'point-operation-unbalanced:%', operation_uuid
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS point_postings_balanced_trigger ON point_postings;
CREATE CONSTRAINT TRIGGER point_postings_balanced_trigger
AFTER INSERT OR UPDATE OR DELETE ON point_postings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_point_operation_balanced();

CREATE TABLE IF NOT EXISTS subscription_assignment_operations (
  id UUID PRIMARY KEY,
  idempotency_key VARCHAR(160) NOT NULL UNIQUE
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{16,160}$'),
  request_hash CHAR(64) NOT NULL
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  subscription_id UUID UNIQUE REFERENCES user_subscriptions(id) ON DELETE RESTRICT,
  bonus_operation_id UUID REFERENCES point_operations(id) ON DELETE RESTRICT,
  response_snapshot JSONB,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (subscription_id IS NULL AND response_snapshot IS NULL AND completed_at IS NULL)
    OR
    (subscription_id IS NOT NULL AND response_snapshot IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS subscription_assignment_operations_actor_idx
  ON subscription_assignment_operations(created_by, created_at DESC);

CREATE OR REPLACE FUNCTION protect_subscription_assignment_operation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subscription-assignment-operation-immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.completed_at IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'subscription-assignment-operation-immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscription_assignment_operations_immutable_guard
  ON subscription_assignment_operations;
CREATE TRIGGER subscription_assignment_operations_immutable_guard
BEFORE UPDATE OR DELETE ON subscription_assignment_operations
FOR EACH ROW EXECUTE FUNCTION protect_subscription_assignment_operation();

CREATE TABLE IF NOT EXISTS point_lots (
  id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES point_wallets(id) ON DELETE RESTRICT,
  source_operation_id UUID NOT NULL REFERENCES point_operations(id) ON DELETE RESTRICT,
  original_amount BIGINT NOT NULL CHECK (original_amount > 0),
  remaining_amount BIGINT NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= original_amount),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wallet_id, source_operation_id)
);

CREATE INDEX IF NOT EXISTS point_lots_consumption_idx
  ON point_lots(wallet_id, expires_at, created_at)
  WHERE remaining_amount > 0;

CREATE TABLE IF NOT EXISTS cdk_campaigns (
  id UUID PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'completed')),
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  rewards JSONB NOT NULL,
  code_count INTEGER NOT NULL CHECK (code_count > 0 AND code_count <= 10000),
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  revoked_by UUID REFERENCES admin_accounts(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cdk_campaigns_rewards_snapshot_check'
      AND conrelid = 'cdk_campaigns'::REGCLASS
  ) THEN
    ALTER TABLE cdk_campaigns
      ADD CONSTRAINT cdk_campaigns_rewards_snapshot_check
      CHECK (
        CASE
          WHEN jsonb_typeof(rewards) = 'object'
            AND rewards ->> 'schemaVersion' = '1'
            AND jsonb_typeof(rewards -> 'items') = 'array'
          THEN jsonb_array_length(rewards -> 'items') BETWEEN 1 AND 50
          ELSE FALSE
        END
      ) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION protect_cdk_campaign_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.rewards IS DISTINCT FROM OLD.rewards
    OR NEW.key_version IS DISTINCT FROM OLD.key_version THEN
    RAISE EXCEPTION 'cdk-campaign-snapshot-immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cdk_campaigns_snapshot_guard ON cdk_campaigns;
CREATE TRIGGER cdk_campaigns_snapshot_guard
BEFORE UPDATE OF rewards, key_version ON cdk_campaigns
FOR EACH ROW EXECUTE FUNCTION protect_cdk_campaign_snapshot();

CREATE TABLE IF NOT EXISTS cdk_codes (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES cdk_campaigns(id) ON DELETE RESTRICT,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  code_hash CHAR(64) NOT NULL UNIQUE,
  code_hint VARCHAR(24) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'redeemed', 'revoked')),
  redeemed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cdk_codes_campaign_idx
  ON cdk_codes(campaign_id, status);

CREATE TABLE IF NOT EXISTS cdk_redemptions (
  id UUID PRIMARY KEY,
  code_id UUID NOT NULL UNIQUE REFERENCES cdk_codes(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES cdk_campaigns(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rewards_snapshot JSONB NOT NULL,
  point_operation_id UUID REFERENCES point_operations(id) ON DELETE RESTRICT,
  subscription_id UUID REFERENCES user_subscriptions(id) ON DELETE RESTRICT,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION protect_cdk_redemption()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cdk-redemption-immutable' USING ERRCODE = '23514';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cdk_redemptions_immutable_guard ON cdk_redemptions;
CREATE TRIGGER cdk_redemptions_immutable_guard
BEFORE UPDATE OR DELETE ON cdk_redemptions
FOR EACH ROW EXECUTE FUNCTION protect_cdk_redemption();

CREATE INDEX IF NOT EXISTS cdk_redemptions_user_time_idx
  ON cdk_redemptions(user_id, redeemed_at DESC);

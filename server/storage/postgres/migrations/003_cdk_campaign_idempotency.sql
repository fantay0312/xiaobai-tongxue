CREATE TABLE IF NOT EXISTS cdk_campaign_creation_operations (
  id UUID PRIMARY KEY,
  created_by UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(160) NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{16,160}$'),
  request_hash CHAR(64) NOT NULL
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  campaign_id UUID UNIQUE REFERENCES cdk_campaigns(id) ON DELETE RESTRICT,
  export_nonce BYTEA,
  export_tag BYTEA,
  export_ciphertext BYTEA,
  export_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (created_by, idempotency_key),
  CHECK (
    (
      completed_at IS NULL
      AND campaign_id IS NULL
      AND export_nonce IS NULL
      AND export_tag IS NULL
      AND export_ciphertext IS NULL
      AND export_expires_at IS NULL
    )
    OR
    (
      completed_at IS NOT NULL
      AND campaign_id IS NOT NULL
      AND export_expires_at IS NOT NULL
      AND export_expires_at = completed_at + INTERVAL '15 minutes'
      AND (
        (
          export_nonce IS NOT NULL
          AND export_tag IS NOT NULL
          AND export_ciphertext IS NOT NULL
          AND OCTET_LENGTH(export_nonce) = 12
          AND OCTET_LENGTH(export_tag) = 16
          AND OCTET_LENGTH(export_ciphertext) > 0
        )
        OR
        (
          export_nonce IS NULL
          AND export_tag IS NULL
          AND export_ciphertext IS NULL
        )
      )
    )
  )
);

CREATE INDEX IF NOT EXISTS cdk_campaign_creation_exports_expiry_idx
  ON cdk_campaign_creation_operations(export_expires_at)
  WHERE export_ciphertext IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_cdk_campaign_creation_operation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'cdk-campaign-operation-invalid-insert' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cdk-campaign-operation-immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'cdk-campaign-operation-immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD.completed_at IS NULL THEN
    IF NEW.completed_at IS NULL
      OR NEW.export_nonce IS NULL
      OR NEW.export_tag IS NULL
      OR NEW.export_ciphertext IS NULL THEN
      RAISE EXCEPTION 'cdk-campaign-operation-incomplete-update' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.export_expires_at IS DISTINCT FROM OLD.export_expires_at
    OR OLD.export_expires_at > NOW()
    OR OLD.export_ciphertext IS NULL
    OR NEW.export_nonce IS NOT NULL
    OR NEW.export_tag IS NOT NULL
    OR NEW.export_ciphertext IS NOT NULL THEN
    RAISE EXCEPTION 'cdk-campaign-operation-immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cdk_campaign_creation_operations_guard
  ON cdk_campaign_creation_operations;
CREATE TRIGGER cdk_campaign_creation_operations_guard
BEFORE INSERT OR UPDATE OR DELETE ON cdk_campaign_creation_operations
FOR EACH ROW EXECUTE FUNCTION protect_cdk_campaign_creation_operation();

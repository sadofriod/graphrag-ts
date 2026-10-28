ALTER TABLE x402_payments
  ADD COLUMN IF NOT EXISTS workspace_id text,
  ADD COLUMN IF NOT EXISTS payload_fingerprint text,
  ADD COLUMN IF NOT EXISTS payload_json jsonb,
  ADD COLUMN IF NOT EXISTS requirements_json jsonb,
  ADD COLUMN IF NOT EXISTS answer_json jsonb,
  ADD COLUMN IF NOT EXISTS settlement_error text,
  ADD COLUMN IF NOT EXISTS settle_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE x402_payments DROP CONSTRAINT IF EXISTS x402_payments_status_check;
UPDATE x402_payments SET status = 'authorized' WHERE status = 'pending';
ALTER TABLE x402_payments ADD CONSTRAINT x402_payments_status_check
  CHECK (status IN ('authorized', 'settling', 'settled', 'settlement_unknown', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS x402_payments_payload_fingerprint_idx
  ON x402_payments (payload_fingerprint) WHERE payload_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS x402_rejected_attempts (
  id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  dataset_id text NOT NULL,
  mode text NOT NULL,
  nonce text,
  payload_hash text NOT NULL,
  payer text,
  reason text NOT NULL
);

CREATE TABLE IF NOT EXISTS x402_payments (
  id uuid PRIMARY KEY,
  request_id text UNIQUE NOT NULL,
  request_hash text NOT NULL,
  nonce text UNIQUE NOT NULL,
  dataset_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('local', 'global')),
  scheme text NOT NULL CHECK (scheme IN ('exact', 'upto')),
  network text NOT NULL,
  asset text NOT NULL,
  amount_authorized numeric(78,0) NOT NULL,
  amount_settled numeric(78,0),
  payer text,
  status text NOT NULL CHECK (status IN ('pending', 'settled', 'failed')),
  transaction text,
  settled_at timestamptz,
  error_reason text,
  response_body jsonb,
  dataset_version text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS x402_payments_created_at_idx ON x402_payments (created_at);
CREATE INDEX IF NOT EXISTS x402_payments_payer_idx ON x402_payments (payer);

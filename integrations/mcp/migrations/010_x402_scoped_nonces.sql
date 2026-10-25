ALTER TABLE x402_payments DROP CONSTRAINT IF EXISTS x402_payments_nonce_key;
ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS nonce_contract text;
ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS nonce_identity text;

UPDATE x402_payments
SET nonce_contract = COALESCE(nonce_contract, CASE
    WHEN scheme = 'upto' OR (payload_json IS NOT NULL AND payload_json->'payload' ? 'permit2Authorization')
      THEN '0x000000000022d473030f116ddee9f6b43ac78ba3'
    ELSE lower(asset)
  END),
  nonce_identity = COALESCE(nonce_identity, CASE
    WHEN nonce ~* '^0x[0-9a-f]+$' THEN '0x' || COALESCE(NULLIF(ltrim(substr(lower(nonce), 3), '0'), ''), '0')
    WHEN nonce ~ '^[0-9]+$' THEN COALESCE(NULLIF(ltrim(nonce, '0'), ''), '0')
    ELSE nonce
  END)
WHERE nonce_contract IS NULL OR nonce_identity IS NULL;

ALTER TABLE x402_payments ALTER COLUMN nonce_contract SET NOT NULL;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY network, lower(COALESCE(payer, '')), nonce_contract, nonce_identity
    ORDER BY CASE status
      WHEN 'settled' THEN 0
      WHEN 'settlement_unknown' THEN 1
      WHEN 'settling' THEN 2
      WHEN 'authorized' THEN 3
      ELSE 4
    END, created_at, id
  ) AS position
  FROM x402_payments
  WHERE nonce_identity IS NOT NULL
)
UPDATE x402_payments AS payment
SET nonce_identity = NULL
FROM ranked
WHERE payment.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS x402_payments_replay_scope_idx
  ON x402_payments (network, lower(COALESCE(payer, '')), nonce_contract, nonce_identity)
  WHERE nonce_identity IS NOT NULL;

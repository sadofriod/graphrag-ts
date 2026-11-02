CREATE TABLE IF NOT EXISTS public_calls (
  id bigserial PRIMARY KEY,
  day date NOT NULL DEFAULT CURRENT_DATE,
  ip_hash text NOT NULL,
  tool text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'error')),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS public_calls_day_tool_idx ON public_calls (day, tool);
CREATE INDEX IF NOT EXISTS public_calls_ip_day_idx ON public_calls (ip_hash, day);

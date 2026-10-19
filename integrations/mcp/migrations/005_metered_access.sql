CREATE TABLE IF NOT EXISTS mcp_usage (
  account_id text NOT NULL,
  period date NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),
  operation text NOT NULL CHECK (operation IN ('index', 'query', 'global_query')),
  units integer NOT NULL CHECK (units > 0),
  PRIMARY KEY (account_id, period, operation)
);

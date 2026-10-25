#!/usr/bin/env bash
set -euo pipefail

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-$POSTGRES_USER}"
POSTGRES_PASSWORD_URLENCODED="${POSTGRES_PASSWORD_URLENCODED:-${POSTGRES_PASSWORD:-}}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"

mkdir -p "$PGDATA"
if [[ -n "$(find "$PGDATA" \( ! -user postgres -o ! -group postgres \) -print -quit)" ]]; then
  chown -R postgres:postgres "$PGDATA"
fi

/usr/local/bin/docker-entrypoint.sh postgres &
postgres_pid=$!

ready=0
for ((second = 0; second < 60; second += 1)); do
  if pg_isready -U "$POSTGRES_USER" -h 127.0.0.1 >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$postgres_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done

if (( ready == 0 )); then
  printf '%s\n' 'allinone: PostgreSQL did not become ready within 60 seconds.' >&2
  exit 1
fi

escaped_db="${POSTGRES_DB//\'/\'\'}"
database_exists="$(psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${escaped_db}'")"
if [[ "$database_exists" != "1" ]]; then
  quoted_db="${POSTGRES_DB//\"/\"\"}"
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${quoted_db}\""
fi

export DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD_URLENCODED}@127.0.0.1:5432/${POSTGRES_DB}}"
cd /workspace/integrations/mcp
/usr/local/bin/bun src/index.ts &
app_pid=$!

shutdown_requested=0
shutdown_deadline=0
forward_signal() {
  if (( shutdown_requested == 0 )); then
    shutdown_requested=1
    shutdown_deadline=$((SECONDS + 30))
    kill -TERM "$app_pid" 2>/dev/null || true
  fi
}
trap forward_signal SIGTERM SIGINT

set +e
while true; do
  wait "$app_pid"
  app_status=$?
  if ! kill -0 "$app_pid" 2>/dev/null; then
    break
  fi
  if (( shutdown_requested == 1 && SECONDS >= shutdown_deadline )); then
    kill -KILL "$app_pid" 2>/dev/null || true
    wait "$app_pid"
    app_status=$?
    break
  fi
  sleep 1
done
set -e

trap - SIGTERM SIGINT
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D '$PGDATA' stop -m fast" >/dev/null 2>&1 || true
wait "$postgres_pid" 2>/dev/null || true
exit "$app_status"

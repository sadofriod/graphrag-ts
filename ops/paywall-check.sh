#!/usr/bin/env bash
# Acceptance check for the MCP paywall contract.
#
#   bash ops/paywall-check.sh            # human summary
#   bash ops/paywall-check.sh --json     # machine-readable
#
# Exit 0 only when every expectation holds. Designed to run from anywhere with
# curl + python3; no credentials needed (that is the point — it probes exactly
# what an anonymous directory crawler sees).

set -uo pipefail

BASE="${MCP_BASE:-https://mcp.ashesborn.cloud/mcp}"
PAY="${PAY_BASE:-https://pay.ashesborn.cloud}"
DOI="${DOI:-10.1016/S0140-6736(97)11096-0}"
JSON=0
[ "${1:-}" = "--json" ] && JSON=1

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

rpc() { # rpc <name> <json-body> <session-or-empty>
  local out="$1" body="$2" sid="${3:-}"
  local args=(-sS -m 60 -o "$out" -w '%{http_code}' -X POST "$BASE"
              -H 'Content-Type: application/json'
              -H 'Accept: application/json, text/event-stream')
  [ -n "$sid" ] && args+=(-H "mcp-session-id: $sid")
  curl "${args[@]}" -d "$body"
}

# ---- 1. anonymous initialize -------------------------------------------------
code=$(curl -sS -m 60 -o /dev/null -D "$TMP/h" -w '%{http_code}' -X POST "$BASE" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"paywall-check","version":"1"}}}')
SID=$(grep -i '^mcp-session-id' "$TMP/h" | tr -d '\r' | cut -d' ' -f2)
rpc "$TMP/n" '{"jsonrpc":"2.0","method":"notifications/initialized"}' "$SID" >/dev/null

# ---- 2. tools/list for an anonymous session --------------------------------
rpc "$TMP/tools.json" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "$SID" >/dev/null
# ---- 3..5 tool calls -------------------------------------------------------
rpc "$TMP/free.json" "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"integrity_paper_status\",\"arguments\":{\"doi\":\"$DOI\"}}}" "$SID" >/dev/null
rpc "$TMP/prop.json" "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"retraction_propagation\",\"arguments\":{\"doi\":\"$DOI\"}}}" "$SID" >/dev/null
rpc "$TMP/audit.json" "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"integrity_evidence_audit\",\"arguments\":{\"doi\":\"$DOI\"}}}" "$SID" >/dev/null

# ---- 6. a bogus bearer must not upgrade the caller --------------------------
code_bogus=$(curl -sS -m 60 -o "$TMP/bogus.json" -w '%{http_code}' -X POST "$BASE" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer not-a-real-token' \
  -d '{"jsonrpc":"2.0","id":6,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"paywall-check","version":"1"}}}')

# ---- 7. the paid HTTP surface still asks for payment ------------------------
code_pay=$(curl -sS -m 60 -o "$TMP/pay.json" -D "$TMP/pay.h" -w '%{http_code}' -X POST "$PAY/api/v1/judge" \
  -H 'Content-Type: application/json' -d "{\"dataset_id\":\"retraction-propagation\",\"doi\":\"$DOI\"}")

python3 - "$TMP" "$code" "$code_bogus" "$code_pay" "$JSON" <<'PY'
import base64, json, os, re, sys

tmp, init_code, bogus_code, pay_code, as_json = sys.argv[1:6]

def payload(path):
    raw = open(path).read()
    m = re.search(r'data: (\{.*\})', raw, re.S)
    if m:
        raw = m.group(1)
    try:
        body = json.loads(raw)
    except Exception:
        return None
    return body

def tool_names(body):
    return [t.get('name') for t in ((body or {}).get('result') or {}).get('tools', [])]

def text_of(body):
    try:
        return ((body['result']['content'][0]['text']) or '')
    except Exception:
        return ''

def is_error(body):
    return bool((body or {}).get('result', {}).get('isError')) or bool((body or {}).get('error'))

def payment_challenge(path):
    with open(path) as headers:
        value = next((line.split(':', 1)[1].strip() for line in headers
                      if line.lower().startswith('payment-required:')), None)
    if not value:
        return None
    try:
        return json.loads(base64.b64decode(value, validate=True))
    except (ValueError, json.JSONDecodeError):
        return None

def has_amount(value):
    if isinstance(value, dict):
        return value.get('amount') == '20000' or any(has_amount(item) for item in value.values())
    if isinstance(value, list):
        return any(has_amount(item) for item in value)
    return False

tools = payload(f'{tmp}/tools.json')
free = payload(f'{tmp}/free.json')
prop = payload(f'{tmp}/prop.json')
audit = payload(f'{tmp}/audit.json')

names = tool_names(tools)
checks = []

checks.append(('anonymous initialize', init_code == '200', f'HTTP {init_code}'))
checks.append(('another bogus bearer rejected or downgraded', bogus_code in ('200', '401', '403'), f'HTTP {bogus_code}'))
checks.append(('tools/list exposed', bool(names), ', '.join(names) or 'none'))
checks.append(('free tool answers with data', bool(text_of(free)) and 'statuses' in text_of(free), text_of(free)[:60] or 'empty'))
checks.append(('propagation is NOT free', is_error(prop), 'payment_required' if is_error(prop) else 'LEAKED verdict=' + str(prop.get('result', {}).get('content', [{}])[0].get('text', ''))[:60]))
checks.append(('evidence audit is NOT free', is_error(audit), 'payment_required' if is_error(audit) else 'LEAKED'))
try:
    with open(f'{tmp}/pay.json') as response_body:
        pay_body = json.load(response_body)
except (OSError, json.JSONDecodeError):
    pay_body = None
challenge = payment_challenge(f'{tmp}/pay.h')
checks.append(('paid HTTP surface challenges',
               pay_code == '402' and pay_body == {} and has_amount(challenge),
               f'HTTP {pay_code}'))

failed = [c for c in checks if not c[1]]
if as_json == '1':
    print(json.dumps({'checks': [{'name': n, 'ok': ok, 'detail': d} for n, ok, d in checks],
                      'failed': len(failed)}, indent=1))
else:
    for name, ok, detail in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name:38s} {detail}")
    print(f"\n{len(checks) - len(failed)}/{len(checks)} passed")
sys.exit(0 if not failed else 1)
PY

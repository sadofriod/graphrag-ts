# Paywall contract — free vs paid, enforced at the protocol boundary

Status: **not met today** (measured 2026-10-28, `ops/paywall-check.sh` → 4/7).
Owner of the fix: the mac-mini deployment (`deploy/integrity` branch + compose stack).
Verifier: anyone, by running `bash ops/paywall-check.sh` from any machine.

## The rule

> A caller with no credential must be able to answer *"is this paper retracted"* and must **not** be able to
> obtain the propagation verdict or the evidence audit. Those two are the product; the status lookup is the
> funnel.

## Surface-by-surface

| Caller | `initialize` | `tools/list` | `integrity_paper_status` | `retraction_propagation` | `integrity_evidence_audit` |
|---|---|---|---|---|---|
| anonymous (no `Authorization`) | 200 | 200, 3 tools | **200 + data** | **`payment_required`** | **`payment_required`** |
| bogus bearer | 401 or 200 downgraded to anonymous | same | same as anonymous | `payment_required` | `payment_required` |
| valid credential / paid lease | 200 | 200 | 200 | 200 + verdict | 200 + full path |

`tools/list` stays at three entries on purpose: a directory crawler should see what the server *can* do, and
each paid tool's description must state its price. Discovery is not the thing being sold; the answer is.

## Shape of the refusal (MCP)

Return a normal JSON-RPC result with `isError: true`, so MCP clients render it as a tool error instead of
retrying, and keep the payload machine-readable:

```json
{
  "jsonrpc": "2.0", "id": 4,
  "result": {
    "isError": true,
    "content": [{
      "type": "text",
      "text": "{\"error\":\"payment_required\",\"product\":\"retraction-propagation\",\"price\":{\"usd\":\"$0.02\",\"atomic\":\"20000\"},\"scheme\":\"x402\",\"network\":\"base\",\"pay_endpoint\":\"https://pay.ashesborn.cloud/api/v1/judge\",\"docs\":\"https://blog.ashesborn.cloud/datasets\"}"
    }]
  }
}
```

Rules for that payload:
- No `verdict`, no `confidence`, no `coverage`, no `retracted_roots`, no `tier_distribution`, no `explain`.
  A teaser is allowed (`{"preview":"verdict withheld"}`); the numbers are not.
- `_meta` may carry the raw x402 challenge (`payment-required`) if the transport supports it.
- Same body for `integrity_evidence_audit` with `"price":{"usd":"$0.10","atomic":"100000"}`.

## Second defect found in the same probe

`POST https://pay.ashesborn.cloud/api/v1/judge` answers `400 {"error":"Invalid request body."}` for every
plausible body (`{"doi":…}`, `{"paper_id":…}`, `{"target":{"doi":…}}`, `{"input":{"doi":…}}`, `{}`), and
`/api/v1/openapi.json` is 401-gated. So a paying customer cannot discover the request shape at all — worse
than a leak, because it makes the paid product unsellable.

Fix, minimum viable:
1. Publish the schema: `GET /api/v1/openapi.json` → 200, no auth. It is a contract, not a secret.
2. Make the 400 say what is expected: `{"error":"invalid_request_body","expected":{"paper_id":"string (OpenAlex) or doi":"string"}}`.
3. A request that parses but carries no payment must return **402** with the `payment-required` header and a
   JSON body (price, scheme, network, pay-to), not 400. Right now the only way to see the price is to guess
   the method.

## Acceptance

```
$ bash ops/paywall-check.sh
PASS  anonymous initialize
PASS  another bogus bearer rejected or downgraded
PASS  tools/list exposed
PASS  free tool answers with data
PASS  propagation is NOT free
PASS  evidence audit is NOT free
PASS  paid HTTP surface challenges
7/7 passed
```

The script exits 1 on any failure, so it can be a pre-deploy gate.

---
name: det-troubleshoot
description: >-
  Diagnose and resolve errors from Deterministic CLI commands, HTTP API calls,
  and MCP tool invocations. Use when a det command fails, an HTTP request
  returns an error, an MCP tool call returns isError: true, or the agent needs
  to understand an exit code, HTTP status, or JSON-RPC error code. Trigger
  phrases: "error", "failing", "not working", "what went wrong", "debug",
  "401", "429", "exit code 2", "invalid_request", "rate limited", "unauthorized",
  "report not found", "payload too large", "why did this fail". Do NOT use for
  first-time credential setup — use det-onboard instead.
---

# det-troubleshoot

Diagnose common errors from the Deterministic CLI, HTTP API, and MCP transport, and identify the correct remediation for each.

## When to use

**Use when:**
- A `det` CLI command exited with a non-zero code and you need to understand why.
- An HTTP API call returned a non-200 status and you need to parse the error envelope.
- An MCP tool call returned `isError: true` and you need to identify the cause.
- You need to handle rate limiting or back off correctly.

**Do not use when:**
- No credentials are configured yet — use det-onboard.
- The error is in bundle construction — use det-prepare-bundle for schema guidance.

## Transports covered

CLI, HTTP, and MCP.

---

## CLI exit codes

| Code | Meaning | Common causes |
|---|---|---|
| `0` | Report received; `recommendation.action = accept`. Also: auth login/logout/whoami success. | — |
| `1` | Report received; `recommendation.action = escalate` or `reject`. | The validation ran; the simulation evidence did not pass. Review the report. |
| `2` | Caller error — the request was not sent or was rejected before processing. | HTTP 4xx response, preflight failure, bundle load failure, missing or invalid API key, credentials file error, invalid host. |
| `3` | Server error — HTTP 5xx. | Transient Deterministic service failure. Retry with back-off. |
| `4` | Local IO or network failure — fetch threw; no HTTP response received. | No internet, DNS failure, wrong host URL, firewall. |
| `64` | Internal CLI bug — uncaught exception. | Report this as a bug with the full stderr output. |

**First check after any non-zero exit:** read stderr. The CLI writes a human-readable error line to stderr on exit codes 2, 3, and 4.

---

## HTTP error codes

All error responses use a shared envelope:

```jsonc
{
  "error": {
    "code": "...",
    "message": "...",
    "fieldErrors": [ /* present for schema failures */ ],
    "details": { /* present for some codes */ },
    "correlationId": "...",  /* present for 500 */
    "artifactId": "..."      /* present for artifact resolution failures */
  }
}
```

### 400 `invalid_request`

Schema or semantic validation failure. Check `error.fieldErrors` for the list of offending fields:

```jsonc
{
  "error": {
    "code": "invalid_request",
    "message": "Request does not match schema",
    "fieldErrors": [
      { "path": "evidence.0.schema", "message": "Required" }
    ]
  }
}
```

Common `fieldErrors` causes:

| `fieldErrors[].path` | Likely fix |
|---|---|
| `evidence.<n>.schema` | The `schema` field is required on every evidence item. |
| `domain` | Use `fluid-simulation` (hyphen, not underscore). The underscore alias `fluid_simulation` is accepted but prefer the canonical form. |
| `mode` | Use `instant` or `flag`. `gate` is reserved and rejected at service time. |
| `user_check_overrides.__proto__` | The keys `__proto__`, `prototype`, and `constructor` are forbidden at every nesting level. |
| `context_provenance.<n>.path` | The path is not in the admitted set. Only `context.method`, `context.operating_regime`, `context.scenario`, `context.time_basis`, and `context.parameters.{dynamic_viscosity,kinematic_viscosity,density}` are accepted. |

For the `GET /api/v1/reports` endpoint, parameter validation errors do not include per-field detail. Re-check all query parameters against the allowed types and ranges (see det-list-reports).

### 401 `unauthorized`

Plain-text `unauthorized` body (no JSON envelope). Causes:

1. `Authorization` header is missing — add `Authorization: Bearer $DETERMINISTIC_API_KEY`.
2. The API key is expired or revoked — generate a new key in the dashboard.
3. The API key format is wrong — keys follow `det_live_<key-id>_<secret>` or `det_test_<key-id>_<secret>`.
4. MCP-source actor on an HTTP-only endpoint — MCP OAuth tokens do not work against the HTTP API endpoints and vice versa.

Verify with `det auth whoami` (CLI) or by checking whether `$DETERMINISTIC_API_KEY` is set in the environment.

### 413 `payload_too_large`

```jsonc
{
  "error": {
    "code": "payload_too_large",
    "message": "Request body exceeds 2097152 bytes",
    "details": { "reason": "request_body" }
  }
}
```

The `POST /api/v1/validate` body cap is **2 MiB**. If evidence files push the bundle over that limit:
1. Upload large evidence files separately using `det-stage-artifact` (`POST /api/artifacts/staging`).
2. Replace the inline `value` in the evidence item with `"uri": "r2-artifact://<requestId>/<artifactId>"`.
3. Re-submit the bundle — it will now be under the cap.

For `POST /api/artifacts/staging`, the per-artifact cap is 100 MiB and the request body cap is 101 MiB.

### 429 `rate_limited`

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
```

Read the `Retry-After` response header (value is seconds until the next window boundary). Wait that many seconds before retrying. Do not retry immediately — the fixed-window counter will still reject the request.

Rate limits:
- `POST /api/v1/validate` and `GET /api/v1/reports/:id`: 100 requests per minute per API key (enforced by Better Auth).
- `GET /api/v1/reports` (listing): 600 requests per minute per owner across all auth modes.
- `POST /api/artifacts/staging`: per-actor hourly attempt window (check `Retry-After`).

### 500 `internal`

```jsonc
{
  "error": {
    "code": "internal",
    "message": "internal error",
    "correlationId": "5fb1…"
  }
}
```

Transient service failure. The `correlationId` is the pivot for support escalation. Retry with exponential back-off. If the error persists, report it with the `correlationId`.

---

## MCP JSON-RPC error codes

MCP errors surface as a `CallToolResult` with `isError: true`, not as a top-level JSON-RPC `error` frame (except for raw HTTP body cap rejections which return HTTP `413` before JSON-RPC parsing).

### Structured error shape

For `validate` tool schema failures, a `structuredContent.error` envelope is also present alongside `content[0].text`:

```jsonc
{
  "isError": true,
  "content": [{ "type": "text", "text": "Request does not match schema" }],
  "structuredContent": {
    "error": {
      "code": "invalid_request",
      "message": "Request does not match schema",
      "fieldErrors": [{ "path": "evidence.0.schema", "message": "Required" }]
    }
  }
}
```

For scope failures and internal errors, only `content[0].text` is set.

### Error code table

| JSON-RPC code | Name | When |
|---|---|---|
| `-32600` | `InvalidRequest` | Missing required OAuth scope. `validate` and `read-report` require the `validate` scope; `submit-feedback` requires `feedback:write`; `list-feedback-candidates` requires `feedback:read`. |
| `-32602` | `InvalidParams` | Tool arguments exceed 2 MiB, or the `validate` arguments do not match `ValidationRequestSchema`. Check `structuredContent.error.fieldErrors`. |
| `-32001` | `report_not_found` | The `reportId` does not exist or belongs to a different account (unified-404). |
| `-32002` | `idempotency_conflict_payload_mismatch` | The same `idempotencyKey` was submitted before with a different payload. Use a new `idempotencyKey` for a different feedback event. |
| `-32603` | `InternalError` | Repository or service failure. `data.correlationId` carries the pivot id for support escalation. |

---

## Common bundle errors

### `fieldErrors` parsing

The `fieldErrors` array uses dot-joined paths. An index in a path (`evidence.0.schema`) refers to the element at that position in the array. For `user_check_overrides`, the check ID itself contains a literal dot — split from the right or use `message` to disambiguate:

```jsonc
{ "path": "user_check_overrides.fluid-sim.eos.eos_tolerance", "message": "..." }
// check ID = "fluid-sim.eos", key = "eos_tolerance"
```

### Missing required fields

Every evidence item requires at minimum: `id`, `kind`, `role`, `format`, and either `value` (inline) or `uri` (artifact reference). Missing any of these produces a `fieldErrors` entry.

### Unknown domain or mode

- `domain`: only `fluid-simulation` (or the alias `fluid_simulation`) is currently supported.
- `mode`: `instant` and `flag` are accepted. `gate` parses but is rejected at service time.

### Artifact not found (`422 artifact_resolution_failed`)

The `r2-artifact://` URI referenced in an evidence item could not be resolved. Causes:
- The artifact was not uploaded before the bundle was submitted.
- The `requestId` or `artifactId` in the URI does not match what was returned by `POST /api/artifacts/staging`.
- The artifact was uploaded as non-retained (`retain=false`) and the staging request already completed — re-upload with `retain=true`.

---

## Auth failure checklist

Run through this list in order:

1. `[ -n "$DETERMINISTIC_API_KEY" ] && echo "set" || echo "not set"` — is the variable set? Never print the full key.
2. `det auth whoami` — does it print a host and key without error?
3. Check the key format: does it start with `det_live_` or `det_test_`?
4. Verify the host: `det auth whoami` shows the active host. Confirm it matches where you expect to send requests.
5. Check for `http://` with a non-loopback host: the CLI rejects this. Use `https://` for all non-localhost targets.
6. If using MCP: confirm your OAuth token has the `validate` scope by checking the `WWW-Authenticate` challenge or the OAuth discovery endpoint (`/.well-known/oauth-protected-resource`).

---

## Examples

### Example 1 — Decode a CLI exit code 2

```bash
det validate --bundle bundle.json
# exit code: 2
# stderr: Error: missing API key
```

Fix:

```bash
export DETERMINISTIC_API_KEY=det_live_<key-id>_<secret>
det validate --bundle bundle.json
```

### Example 2 — Handle a 429 rate limit in a shell loop

```bash
while true; do
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
    -H "Content-Type: application/json" \
    -d @bundle.json \
    "https://deterministic.sh/api/v1/validate")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -n -1)

  if [ "$http_code" = "429" ]; then
    retry_after=$(curl -sI \
      -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
      "https://deterministic.sh/api/v1/validate" | \
      grep -i 'retry-after' | awk '{print $2}' | tr -d '\r')
    echo "Rate limited. Waiting ${retry_after}s..."
    sleep "$retry_after"
  else
    echo "$body"
    break
  fi
done
```

### Example 3 — Parse fieldErrors from a 400 response

```bash
curl -s \
  -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d @bad-bundle.json \
  "https://deterministic.sh/api/v1/validate" | \
  jq '.error.fieldErrors[] | "\(.path): \(.message)"'
```

Output:

```
"evidence.0.schema: Required"
"domain: Invalid enum value"
```

Fix the bundle fields indicated by each `path`, then resubmit.

---
name: det-read-report
description: >-
  Fetch a previously persisted Deterministic validation report by ID and
  present a structured summary of its status, per-check breakdown, and
  domain-specific findings. Use when an agent needs to check the result of an
  earlier validation run, retrieve a report by a known ID, or surface check
  failures to a downstream process. Do NOT use to interpret or
  decide on the results — use det-interpret-results for that. Do NOT use when
  you do not yet have a report ID — run det-validate first.
---

# det-read-report

Fetch a Deterministic validation report by ID and present its overall status, per-check results, and failure details.

## When to use

**Use when:**
- You have a `reportId` from a previous `det validate` run or MCP `validate` call and need the full result.
- A downstream step requires the pass/fail/uncertain verdict before proceeding.
- You want to surface which checks failed and their status.

**Do not use when:**
- You do not yet have a `reportId` — call `det-validate` first.
- You want to decide what to do about the results — use `det-interpret-results` for that.

## Prerequisites

- A valid `reportId` (UUID v4). Obtained from a prior `det validate` / MCP `validate` response.
- An API credential with at least the `validate` scope (covers both `validate` and `read-report`).

## Transport selection

Three equivalent transports are available. Choose based on your runtime context.

| Transport | When to use |
|---|---|
| CLI | Interactive terminal use, shell scripts, CI pipelines where `det` is installed |
| HTTP | Any language that can issue HTTP requests; works when the CLI is not available |
| MCP | Running inside an MCP host (Claude desktop, VS Code Copilot, ChatGPT) with an active Deterministic MCP connection |

All three return the same `ReportResponse` payload.

## Steps

### CLI

```bash
# Pretty (default on TTY)
det get report <reportId>

# Machine-readable JSON (default on non-TTY; explicit flag on TTY)
det get report <reportId> --json

# Target a specific host
det get report <reportId> --host https://api.yourdomain.com
```

Auth: reads `DETERMINISTIC_API_KEY` from the environment, or the stored credentials from `det auth login`.

Exit codes: `0` = report fetched (check verdict for pass/fail), `2` = 4xx (bad ID, not found, no auth), `3` = 5xx.

### HTTP

```http
GET /api/v1/reports/<reportId> HTTP/1.1
Authorization: Bearer det_live_<key-id>_<secret>
```

Optional: `X-Correlation-Id: <your-id>` — echoed in the response header for log correlation.

### MCP

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "read-report",
    "arguments": { "reportId": "5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a" }
  }
}
```

Required scope: `validate` (same scope that covers the `validate` tool).

On success, `structuredContent` contains the full `ReportResponse`. If the host supports MCP Apps, the bundled Preact UI renders inline via `ui://validation-report`.

## Output interpretation

A successful response has this shape (HTTP 200 / MCP `isError: false`):

```jsonc
{
  "reportId": "5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a",
  "correlationId": "5fb1…",
  "domain": "fluid-simulation",
  "mode": "instant",
  "createdAt": "2026-05-08T12:00:00.000Z",
  "summary": {
    "overall_status": "fail",        // "pass" | "fail" | "uncertain"
    "definitive_passes": 3,
    "definitive_failures": 2,
    "uncertain": 0,
    "not_run": 1,
    "timeouts": 0
  },
  "recommendation": {
    "action": "reject"               // "accept" | "escalate" | "reject"
  },
  "checks": [
    {
      "id": "reynolds-number-regime",
      "status": "fail",
      "message": "Computed Re exceeds laminar threshold (Re=1847 > 2300)",
      "evidence": ["centerline_velocity"]
    },
    {
      "id": "mass-conservation",
      "status": "pass",
      "message": "Net mass flux within tolerance"
    }
    // …
  ],
  "claims": [ /* claim-level verdicts */ ]
}
```

**Overall status meanings:**

| `report.summary.overall_status` | `report.recommendation.action` | Meaning |
|---|---|---|
| `pass` | `accept` | All checks passed; report is consistent with claimed parameters |
| `fail` | `reject` | One or more checks failed; do not treat results as validated |
| `uncertain` | `escalate` | Checks ran but could not reach a definitive verdict; human review warranted |

**Per-check `status` values:**

| Value | Meaning |
|---|---|
| `pass` | Check succeeded |
| `fail` | Check detected an inconsistency or violation |
| `uncertain` | Check ran but could not determine a verdict (e.g. insufficient evidence) |
| `not_run` | Check was skipped (domain/regime not applicable, or dependency check failed) |
| `timeout` | Check exceeded its time budget; treated as `uncertain` for claim derivation |

When reporting results, list `fail` checks first, then `uncertain`, then `timeout`.

## Error handling

Both HTTP and MCP use a unified 404 — there is no distinction between a report that does not exist and one that belongs to a different actor. This prevents information leakage.

| Condition | HTTP | MCP |
|---|---|---|
| Report not found or belongs to another actor | `404 report_not_found` | `isError: true`, `structuredContent.error.code = "not_found"` |
| Invalid or missing API key | `401 unauthorized` (plain text) | `isError: true`, code `-32600 InvalidRequest` |
| `reportId` not a valid UUID | `400` or `422` | `isError: true`, code `-32602 InvalidParams` |
| Repository failure | `500 internal` (message redacted) | `isError: true`, code `-32603 InternalError`; `data.correlationId` available for support |

On a `not_found` error, verify:
1. The `reportId` is copied exactly — no truncation, no extra whitespace.
2. The credential matches the one used when the report was created (reports are actor-scoped).
3. The report was not submitted to a different environment (production vs. preview host).

## Examples

### Example 1 — CLI fetch, TTY pretty output

```bash
export DETERMINISTIC_API_KEY=det_live_abc123_secretpart

det get report 5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a
```

Expected TTY output (approximate):

```
Report  5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a
Status  fail (reject)
Domain  fluid-simulation  Mode instant

Checks
  ✗ reynolds-number-regime [critical]  Computed Re exceeds laminar threshold
  ✓ mass-conservation [major]          Net mass flux within tolerance
  ✗ pressure-continuity [major]        Pressure residual did not converge
  ○ turbulence-intensity [not_run]     Skipped — regime is laminar
```

CLI exits `1` when `recommendation` is `reject` or `escalate`.

### Example 2 — HTTP fetch in a CI script

```bash
REPORT_ID="5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a"
RESPONSE=$(curl -sf \
  -H "Authorization: Bearer ${DETERMINISTIC_API_KEY}" \
  "https://api.yourdomain.com/api/v1/reports/${REPORT_ID}")

STATUS=$(echo "$RESPONSE" | jq -r '.summary.overall_status')
echo "Validation status: $STATUS"

if [ "$STATUS" != "pass" ]; then
  echo "Failing checks:"
  echo "$RESPONSE" | jq -r '.checks[] | select(.status == "fail") | "  \(.id) — \(.message)"'
  exit 1
fi
```

### Example 3 — MCP tool call from an agent

```jsonc
// Request
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "read-report",
    "arguments": { "reportId": "a2b3c4d5-e6f7-8901-abcd-ef1234567890" }
  }
}

// Success response (abbreviated)
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [{ "type": "text", "text": "Report a2b3… status: pass (accept). 4/4 checks passed." }],
    "structuredContent": {
      "reportId": "a2b3c4d5-e6f7-8901-abcd-ef1234567890",
      "summary": { "overall_status": "pass", "definitive_passes": 4, "definitive_failures": 0, "uncertain": 0, "not_run": 0, "timeouts": 0 },
      "recommendation": { "action": "accept" },
      "checks": [ /* … */ ]
    }
  }
}
```

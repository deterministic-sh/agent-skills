---
name: det-submit-feedback
description: >-
  Submit reviewer feedback for a Deterministic validation report via HTTP or
  MCP. Use when a human reviewer or automated pipeline needs to confirm,
  override, or annotate a report-level verdict, a specific check result, or an
  individual claim. Generates a UUID idempotency key automatically when the
  caller does not supply one. Do NOT use the CLI for this — the CLI does not
  support feedback submission. Do NOT use when you do not yet have a reportId
  or when the report is not accessible to your credential.
---

# det-submit-feedback

Submit reviewer feedback targeting a report, a check, or a claim. Records a `FeedbackEvent` that can confirm, override, or annotate the automated verdict.

## When to use

**Use when:**
- A reviewer has inspected a failing or uncertain check and wants to record a disposition.
- An automated pipeline wants to programmatically confirm an accepted result for audit purposes.
- You need to annotate a check with a parameter value or note without changing its status.

**Do not use when:**
- You have not yet fetched the report — call `det-read-report` first to verify the checks you want to target.
- You are using the CLI — the `det` CLI does not support feedback submission. Use HTTP or MCP instead.
- The `reportId` does not belong to the credential you are using — the endpoint returns a unified 404 for both not-found and ownership-mismatch cases.

## Prerequisites

- A valid `reportId` (UUID v4).
- For HTTP: an API key with the standard `validate` scope (feedback endpoints use the same `withApiKeyAuth` middleware). Session cookies are explicitly rejected; obtain an API key.
- For MCP: an OAuth token with the `feedback:write` scope.
- An `idempotencyKey` (max 256 chars). Auto-generate a UUID v4 if the caller does not supply one. Reuse the same key to safely retry without creating a duplicate event.

## Transport selection

| Transport | Available? | Notes |
|---|---|---|
| CLI | No | The `det` CLI does not support feedback submission. |
| HTTP | Yes | `POST /api/v1/reports/:id/feedback` |
| MCP | Yes | `submit-feedback` tool, requires `feedback:write` scope |

## `FeedbackInput` shape

The canonical schema is defined in `specs/96-reviewer-feedback-loop.spec.md`. The same shape is used for both HTTP (as the request body) and MCP (as the `payload` field inside `arguments`).

```jsonc
{
  // REQUIRED: what the feedback targets
  "scope": { "kind": "report" },
  // OR: { "kind": "check", "checkId": "<check-id>" }
  // OR: { "kind": "claim", "claimId": "<claim-id>" }

  // REQUIRED: what the reviewer is doing
  "action": "confirm",    // "confirm" | "override" | "annotate"

  // verdict — only when scope.kind = "report"
  "verdict": "accept",    // "accept" | "reject"

  // targetStatus — only when scope.kind = "check"
  "targetStatus": "pass", // "pass" | "fail" | "uncertain" | "not_run"

  // parameterName + parameterValue — paired; both present or both absent
  // parameterValue: canonical JSON string, max 1024 bytes
  "parameterName": "eos_tolerance",
  "parameterValue": "0.05",

  // note: free-text, max 4096 bytes
  "note": "Confirmed against lab data from 2026-01 run.",

  // REQUIRED: idempotency key, max 256 chars
  "idempotencyKey": "reviewer-abc-report-5f1c-1"
}
```

**Field rules:**

| Field | Required | Constraint |
|---|---|---|
| `scope` | Yes | One of `{ kind: "report" }`, `{ kind: "check", checkId: string }`, `{ kind: "claim", claimId: string }` |
| `action` | Yes | `"confirm"` \| `"override"` \| `"annotate"` |
| `verdict` | When `scope.kind = "report"` | `"accept"` \| `"reject"`. Error if present for check/claim scope. |
| `targetStatus` | When `scope.kind = "check"` | `"pass"` \| `"fail"` \| `"uncertain"` \| `"not_run"` |
| `parameterName` | Paired with `parameterValue` | Must both be present or both absent |
| `parameterValue` | Paired with `parameterName` | Canonical JSON string; max 1024 bytes; must not be JSON `null` |
| `note` | No | Max 4096 bytes |
| `idempotencyKey` | Yes | Max 256 chars. Auto-generate a UUID v4 if not supplied by the caller. |

## Steps

### HTTP

```http
POST /api/v1/reports/<reportId>/feedback HTTP/1.1
Authorization: Bearer det_live_<key-id>_<secret>
Content-Type: application/json

{
  "scope": { "kind": "check", "checkId": "reynolds-number-regime" },
  "action": "override",
  "targetStatus": "pass",
  "note": "Re computed with corrected viscosity value; regime is confirmed laminar.",
  "idempotencyKey": "reviewer-jdoe-report-5f1c-check-rn-1"
}
```

### MCP

```jsonc
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "submit-feedback",
    "arguments": {
      "reportId": "5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a",
      "payload": {
        "scope": { "kind": "check", "checkId": "reynolds-number-regime" },
        "action": "override",
        "targetStatus": "pass",
        "note": "Re computed with corrected viscosity value; regime is confirmed laminar.",
        "idempotencyKey": "reviewer-jdoe-report-5f1c-check-rn-1"
      }
    }
  }
}
```

Note: `reportId` is a top-level field in `arguments`; `payload` is the `FeedbackInput` body.

## Output interpretation

On success (HTTP `200` / MCP `isError: false`):

```jsonc
{
  "event": {
    "id": "fev_…",
    "reportId": "5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a",
    "scope": { "kind": "check", "checkId": "reynolds-number-regime" },
    "action": "override",
    "targetStatus": "pass",
    "note": "Re computed with corrected viscosity value; regime is confirmed laminar.",
    "idempotencyKey": "reviewer-jdoe-report-5f1c-check-rn-1",
    "createdAt": "2026-05-08T12:00:00.000Z"
  },
  "outcome": "inserted"   // "inserted" | "idempotent_replay"
}
```

`outcome: "idempotent_replay"` — a previous event with the same `idempotencyKey` was already recorded for this report and actor. The stored event is returned unchanged; no new row is written. This is the safe retry path.

## Error handling

| HTTP status | Error code | MCP code | Cause | Resolution |
|---|---|---|---|---|
| `401` | (plain text) | `-32600 InvalidRequest` | Missing/invalid API key, or session-based caller | Use an API key in the `Authorization` header; session cookies are rejected |
| `401` | — | `-32600 InvalidRequest` | Missing `feedback:write` scope (MCP) | Obtain an OAuth token that includes the `feedback:write` scope |
| `404` | `report_not_found` | `-32001` | Report does not exist, or belongs to another actor | Verify the `reportId` and that the credential was used to create it |
| `409` | `idempotency_conflict_payload_mismatch` | `-32002` | Same `idempotencyKey`, different payload for this report+actor | Use a different `idempotencyKey` for a genuinely different feedback event |
| `413` | `note_too_long` | — | `note` exceeds 4096 bytes | Truncate the note |
| `413` | `parameter_value_too_large` | — | `parameterValue` exceeds 1024 bytes | Reduce the JSON value or split across multiple events |
| `415` | `unsupported_media_type` | — | `Content-Type` is not `application/json` | Set the header correctly |
| `400` | `payload_invalid` | `-32602 InvalidParams` | JSON parse failure or Zod schema failure | Inspect the response `fieldErrors` for the specific path |
| `400` | `scope_invalid` | `-32602 InvalidParams` | `scope.kind` is not `"report"`, `"check"`, or `"claim"` | Use one of the three allowed scope shapes |
| `400` | `verdict_misapplied` | `-32602 InvalidParams` | `verdict` present for a non-report scope, or absent for a report scope | Include `verdict` only when `scope.kind = "report"` |
| `500` | `internal` | `-32603 InternalError` | Unhandled exception (message redacted) | Retry with the same `idempotencyKey`; contact support with the `data.correlationId` if it persists |

**`idempotency_conflict_payload_mismatch`:** This error means an event with the same `idempotencyKey` exists but with a different payload. If you want to amend the feedback, use a new `idempotencyKey`. If you are retrying a failed submission, reuse the original payload exactly.

## Examples

### Example 1 — Report-scope confirmation (HTTP)

A reviewer accepts the overall report after inspecting the evidence.

```http
POST /api/v1/reports/5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a/feedback HTTP/1.1
Authorization: Bearer det_live_abc123_secretpart
Content-Type: application/json

{
  "scope": { "kind": "report" },
  "action": "confirm",
  "verdict": "accept",
  "note": "Reviewed velocity profiles and residuals. Results are consistent with expected laminar cavity flow at Re=100.",
  "idempotencyKey": "reviewer-jdoe-2026-05-08-report-5f1c-accept"
}
```

```jsonc
// 200 OK
{
  "event": {
    "id": "fev_01hz…",
    "reportId": "5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a",
    "scope": { "kind": "report" },
    "action": "confirm",
    "verdict": "accept",
    "note": "Reviewed velocity profiles and residuals. Results are consistent with expected laminar cavity flow at Re=100.",
    "idempotencyKey": "reviewer-jdoe-2026-05-08-report-5f1c-accept",
    "createdAt": "2026-05-08T14:32:11.000Z"
  },
  "outcome": "inserted"
}
```

### Example 2 — Check-scope override with parameter annotation (MCP)

A reviewer overrides a failing tolerance check and records the accepted tolerance value.

```jsonc
// MCP request
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "submit-feedback",
    "arguments": {
      "reportId": "a2b3c4d5-e6f7-8901-abcd-ef1234567890",
      "payload": {
        "scope": { "kind": "check", "checkId": "eos-consistency" },
        "action": "override",
        "targetStatus": "pass",
        "parameterName": "eos_tolerance",
        "parameterValue": "0.05",
        "note": "EOS tolerance widened to 5% per project-level calibration agreement dated 2026-04-15.",
        "idempotencyKey": "reviewer-sys-report-a2b3-check-eos-1"
      }
    }
  }
}

// Success response
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "content": [{ "type": "text", "text": "Feedback recorded." }],
    "structuredContent": {
      "event": {
        "id": "fev_02ab…",
        "reportId": "a2b3c4d5-e6f7-8901-abcd-ef1234567890",
        "scope": { "kind": "check", "checkId": "eos-consistency" },
        "action": "override",
        "targetStatus": "pass",
        "parameterName": "eos_tolerance",
        "parameterValue": "0.05",
        "note": "EOS tolerance widened to 5% per project-level calibration agreement dated 2026-04-15.",
        "idempotencyKey": "reviewer-sys-report-a2b3-check-eos-1",
        "createdAt": "2026-05-08T15:10:00.000Z"
      },
      "outcome": "inserted"
    }
  }
}
```

### Example 3 — Claim-scope annotation (HTTP)

An agent records a note against a specific claim without changing its status.

```http
POST /api/v1/reports/5f1c6e9e-1e0a-4f84-9a1e-a14b60bb3f6a/feedback HTTP/1.1
Authorization: Bearer det_live_abc123_secretpart
Content-Type: application/json

{
  "scope": { "kind": "claim", "claimId": "c1" },
  "action": "annotate",
  "note": "Claim c1 references the corrected centerline profile after mesh refinement in run v3.",
  "idempotencyKey": "agent-pipeline-report-5f1c-claim-c1-note-1"
}
```

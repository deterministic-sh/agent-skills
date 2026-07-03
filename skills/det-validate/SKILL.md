---
name: det-validate
description: >-
  Submit a simulation evidence bundle to Deterministic for structured
  validation and receive a verdict with per-check results. The primary skill
  for any validation workflow. Use when an agent has simulation results to
  verify, when it needs to check physical plausibility, when it needs an
  auditable receipt for a validation run, or when another agent asks it to
  validate simulation output. Supports CLI, HTTP, and MCP transports; prefers
  CLI when available. Do NOT use for file uploads >2 MiB — use det-stage-artifact
  first and reference the returned URI in the bundle.
---

# det-validate

Submit a `ValidationRequest` bundle to Deterministic and interpret the resulting report.

## When to use

**Use when:**
- You have a simulation evidence bundle (or can construct one) and need a verdict.
- You need physical plausibility checks, regime classification, or claim verification.
- You need an auditable `reportId` to attach to a simulation run record.

**Do not use when:**
- Evidence files are larger than 2 MiB — stage them first with `det-stage-artifact`, then reference the artifact URIs here.
- You only need to assemble the bundle, not submit it — use `det-prepare-bundle`.
- You want to retrieve a previously run report — use `det read-report <id>` or `GET /api/v1/reports/:id`.

## Prerequisites

- **CLI**: `det` binary available on `PATH`; API key in `DETERMINISTIC_API_KEY` or configured via `det auth login`.
- **HTTP**: API key as `Authorization: Bearer det_live_<key-id>_<secret>`.
- **MCP**: OAuth access token with the `validate` scope; server at `https://<host>/mcp`.

## Transport selection

1. **CLI preferred** — use `det validate` if the `det` binary is available and the bundle is on disk. Handles auth, error mapping, and pretty output automatically.
2. **HTTP** — use `POST /api/v1/validate` when the CLI is unavailable or the caller is making a programmatic API call.
3. **MCP** — use the `validate` tool when operating inside a host that has the Deterministic MCP server configured (Claude desktop, ChatGPT, VS Code Copilot).

## Steps

### CLI path

```bash
det validate --bundle <path> [flag overrides]
```

Override flags apply on top of the bundle JSON:

| Flag | Wire path |
|---|---|
| `--domain` | `domain` |
| `--mode` | `mode` |
| `--result-source` | `result_source` |
| `--scenario` | `context.scenario` |
| `--method` | `context.method` |
| `--operating-regime` | `context.operating_regime` |
| `--fluid-id` | `context.fluid_id` |
| `--time-basis` | `context.time_basis` |

Use `--pretty` for human-readable output. Use `--json` for machine-readable output (default on non-TTY). Use `--verbose` to see which fields the flag layer touched.

Reading from stdin:

```bash
cat bundle.json | det validate --bundle -
```

### HTTP path

```http
POST /api/v1/validate HTTP/1.1
Authorization: Bearer det_live_<key-id>_<secret>
Content-Type: application/json

<ValidationRequest JSON body>
```

Body cap: **2 MiB**. Larger bodies return `413 payload_too_large` before JSON parsing.

Optional: supply `X-Correlation-Id` to track the request in logs.

### MCP path

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "validate",
    "arguments": {
      "version": "0.1",
      "domain": "fluid-simulation",
      "mode": "instant",
      "context": { ... },
      "evidence": [ ... ],
      "claims": [ ... ]
    }
  }
}
```

The MCP surface shares the same `ValidationRequestSchema` as HTTP. Note: `userCheckOverrides` (camelCase) is silently dropped; use `user_check_overrides` (snake_case).

## Parameter inference heuristics

If the bundle is missing fields, infer them from available context and declare provenance for each inferred value.

| Signal | Inferred field |
|---|---|
| `.foam`, `.cas`, `.dat`, `.vtk` extensions | `domain` = `fluid-simulation` |
| `turbulenceProperties`, `RASModel`, `LESModel` | `context.operating_regime` = `turbulent` |
| `Re < 2300` from log, `laminarFlow` keyword | `context.operating_regime` = `laminar` |
| `steadyState` time scheme, `simple` solver | `context.time_basis` = `steady` |
| `pimple`, `piso` solver | `context.time_basis` = `transient` |
| `fvSolution`, `blockMesh` | `context.method` = `FVM` |

## `context_provenance` — admitted paths

Declare provenance for any field value you inferred rather than reading directly. Use `tag: "llm_inferred"` for derived values, `tag: "llm_normalized"` for caller-stated values you canonicalized.

**Admitted paths** (any other path returns `400 invalid_context_provenance_path`):

- `context.method`
- `context.operating_regime`
- `context.scenario`
- `context.time_basis`
- `context.parameters.dynamic_viscosity`
- `context.parameters.kinematic_viscosity`
- `context.parameters.density`

**Not admitted:** `context.fluid_id`, `context.result_source`, `context.claimed_units.*`.

Inferred provenance can only lower or cap confidence — it never raises a verdict. When an `llm_inferred` or `llm_normalized` path lands on a verdict-affecting field, the engine caps the overall verdict at `uncertain` with reason `llm_parameter_dependency`.

## Output interpretation

### Verdict (`report.summary.overall_status`)

| Status | Meaning | Recommended action |
|---|---|---|
| `pass` | All run checks satisfied the claims. | Accept the result. Record the `reportId`. |
| `fail` | One or more checks found the evidence does not satisfy the claims. | Review failing `checks[]` entries. Fix the simulation or re-examine the claims. |
| `uncertain` | Checks ran but could not reach a deterministic verdict (e.g. LLM-inferred parameter dependency, phase ambiguity). | Review `checks[].verdict_reason`. Provide explicit parameters to remove uncertainty. |
| `not_run` | No checks ran (missing evidence, unsupported domain, etc.). | Check `coverage[].not_run` for reasons. Ensure evidence items are properly shaped. |

### Per-check `status` values

- `pass` — check ran and evidence satisfies the claim.
- `fail` — check ran, evidence does not satisfy the claim.
- `uncertain` — ran, could not reach a deterministic verdict.
- `not_run` — skipped; see `not_run_reason`.
- `timeout` — check exceeded its time budget (`timeout_reason`: `handler_budget_exceeded` or `dispatcher_guard_exceeded`). Counts toward `summary.timeouts`. Treated as `uncertain` for claim derivation.

## Error handling

### CLI exit codes

| Code | Meaning | Action |
|---|---|---|
| `0` | Report received, recommendation `accept`. | Proceed. |
| `1` | Report received, recommendation `escalate` or `reject`. | Investigate failing checks. |
| `2` | Caller error — HTTP 4xx, preflight failure, bundle load failure, missing API key. | Fix the bundle or credentials before retrying. |
| `3` | Server error — HTTP 5xx. | Wait and retry once. If persistent, report with `correlationId`. |
| `4` | Local IO / network failure — no HTTP response. | Check network connectivity and host URL. |
| `64` | Internal CLI bug — uncaught exception. | Report the full output. |

### HTTP status codes

| Status | Code | Action |
|---|---|---|
| `200` | — | Parse `report`. |
| `400 invalid_request` | — | Fix `fieldErrors`. Check `invalid_context_provenance_path` / `invalid_context_provenance_conflict` for provenance issues. |
| `401` | — | Set or refresh the API key. |
| `413 payload_too_large` | — | Bundle exceeds 2 MiB. Stage large evidence files with `det-stage-artifact`. |
| `422 invalid_request` | `artifact_resolution_failed` | The artifact URI was not found. Confirm `retain=true` was used during staging and the `requestId`/`artifactId` match. |
| `422 invalid_request` | `declared_format_mismatch` | The declared `format` does not match the artifact's byte signature. Omit `format` to let the engine detect it, or re-upload with the correct label. |
| `500 internal` | — | Retry once. Use `correlationId` to report the incident. |

### MCP JSON-RPC errors

| Code | Name | Action |
|---|---|---|
| `-32600` | `InvalidRequest` | Missing `validate` scope. Re-authorize with the `validate` scope. |
| `-32602` | `InvalidParams` | Arguments exceed 2 MiB or fail `ValidationRequestSchema`. Fix `structuredContent.error.fieldErrors`. |
| `-32603` | `InternalError` | Repository failure after service completion. Use `data.correlationId` to report. |

Service-level failures (the engine ran but the submission was invalid) return a `CallToolResult` with `isError: true` and `structuredContent.error`, not a JSON-RPC protocol error.

## Examples

### Example 1 — CLI, bundle file with flag overrides

```bash
export DETERMINISTIC_API_KEY=det_live_k1_abc123

det validate \
  --bundle ./cavity_bundle.json \
  --operating-regime laminar \
  --time-basis steady \
  --pretty
```

Exit code `0` on accept, `1` on escalate/reject.

### Example 2 — HTTP, inline evidence

```bash
curl -s -X POST https://deterministic.sh/api/v1/validate \
  -H "Authorization: Bearer det_live_k1_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "0.1",
    "domain": "fluid-simulation",
    "mode": "instant",
    "context": {
      "scenario": "lid-driven-cavity-Re100",
      "method": "FVM",
      "operating_regime": "laminar",
      "time_basis": "steady",
      "fluid_id": "air_dry"
    },
    "context_provenance": [
      { "path": "context.operating_regime", "tag": "llm_inferred" }
    ],
    "evidence": [
      {
        "id": "centerline_velocity",
        "kind": "series",
        "role": "primary_result",
        "format": "json",
        "schema": { "x": "number", "u": "number" },
        "value": [{ "x": 0.0, "u": 0.0 }, { "x": 0.5, "u": 0.22 }, { "x": 1.0, "u": 0.0 }]
      }
    ],
    "claims": [
      {
        "id": "c1",
        "kind": "range",
        "subject": "centerline_velocity.u",
        "expectation": "velocity stays within the expected laminar cavity band"
      }
    ]
  }' | jq '.report.summary'
```

### Example 3 — MCP tool call inside a Claude conversation

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "validate",
    "arguments": {
      "version": "0.1",
      "domain": "fluid-simulation",
      "mode": "instant",
      "context": {
        "scenario": "pipe-Re12000",
        "method": "FVM",
        "operating_regime": "turbulent",
        "time_basis": "steady"
      },
      "context_provenance": [
        { "path": "context.operating_regime", "tag": "llm_inferred" },
        { "path": "context.time_basis", "tag": "llm_inferred" }
      ],
      "evidence": [
        {
          "id": "axial_profile",
          "kind": "series",
          "role": "primary_result",
          "format": "csv",
          "schema": { "r": "number", "u_axial": "number" },
          "uri": "r2-artifact://req_pipe_001/art_axial_vel"
        }
      ],
      "claims": [
        {
          "id": "c1",
          "kind": "range",
          "subject": "axial_profile.u_axial",
          "expectation": "axial velocity is consistent with fully developed turbulent pipe flow"
        }
      ]
    }
  }
}
```

On success, read the verdict from `result.structuredContent.report.summary.overall_status`. The `reportId` in `result.structuredContent.reportId` is the persistent audit reference. Hosts that support MCP Apps will render the report inline via `ui://validation-report`.

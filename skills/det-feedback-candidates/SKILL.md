---
name: det-feedback-candidates
description: >-
  Query aggregated Deterministic reviewer-feedback statistics for a domain to
  identify checks that are frequently overridden, annotated, or uncertain. Use
  when you want to understand which checks human reviewers routinely disagree
  with, surface patterns that may warrant rule-set updates, or gather
  parameter-value distributions from past overrides. Requires a domain
  parameter. Do NOT use when you need a specific report — use det-read-report
  for that. Do NOT use without a domain — the endpoint rejects requests where
  domain is absent.
---

# det-feedback-candidates

Query aggregated reviewer-feedback statistics grouped by domain, scenario, regime, and check/claim scope to identify recurring patterns across validation history.

## When to use

**Use when:**
- You want to find which checks reviewers have overridden most often in a given domain or scenario.
- You need parameter-value distributions from past overrides to inform a rule calibration.
- You want to detect high-uncertainty checks that may indicate gaps in the check's evidence requirements.
- You are preparing a rule-set update and need data on where the automated checks diverge from reviewer judgment.

**Do not use when:**
- You need the result of a specific report — use `det-read-report` instead.
- You do not have a domain value — the endpoint requires `domain` and returns `400` without it.

## Prerequisites

- For HTTP: an API key with the standard `validate` scope.
- For MCP: an OAuth token with the `feedback:read` scope.
- A known canonical domain string (e.g. `fluid-simulation`). Domain aliases are canonicalized server-side, but use the canonical form to be safe.

## Transport selection

| Transport | Available? | Notes |
|---|---|---|
| CLI | No | The `det` CLI does not support this endpoint. |
| HTTP | Yes | `GET /api/v1/reviewer-feedback/candidates` |
| MCP | Yes | `list-feedback-candidates` tool, requires `feedback:read` scope |

## Steps

### HTTP

```http
GET /api/v1/reviewer-feedback/candidates?domain=fluid-simulation HTTP/1.1
Authorization: Bearer det_live_<key-id>_<secret>
```

Optional query parameters:

| Parameter | Required | Notes |
|---|---|---|
| `domain` | **Yes** | Canonical domain string. Returns `400 invalid_request` if absent. |
| `scenario` | No | Filter to a specific scenario identifier. |
| `regime` | No | Filter to a specific operating regime (e.g. `laminar`, `turbulent`). |

```http
# With optional filters
GET /api/v1/reviewer-feedback/candidates?domain=fluid-simulation&scenario=lid-driven-cavity-Re100&regime=laminar HTTP/1.1
Authorization: Bearer det_live_<key-id>_<secret>
```

### MCP

```jsonc
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "list-feedback-candidates",
    "arguments": {
      "domain": "fluid-simulation",
      "scenario": "lid-driven-cavity-Re100",
      "regime": "laminar"
    }
  }
}
```

`scenario` and `regime` are optional.

## Output interpretation

Response shape (HTTP `200` / MCP `isError: false`, `structuredContent`):

```jsonc
{
  "candidates": [
    {
      "domain": "fluid-simulation",
      "scenario": "lid-driven-cavity-Re100",
      "regime": "laminar",
      "scopeKind": "check",      // "check" | "claim"
      "scopeId": "reynolds-number-regime",
      "parameterName": "eos_tolerance",
      "totalEvents": 12,
      "actions": {
        "confirm": 5,
        "override": 6,
        "annotate": 1
      },
      "latestAction": "2026-05-07T18:00:00.000Z",
      // Present when scopeKind = "check" and overrides carry numeric parameterValues
      "inferredValueDistribution": {
        "samples": 6,
        "min": 0.01,
        "max": 0.1,
        "median": 0.05
      },
      // Present instead when values are non-numeric strings
      // "categoricalDistribution": { "0.05": 4, "0.1": 2 },
      "exampleReportIds": [
        "5f1c6e9e-…",
        "a2b3c4d5-…"
      ]
    }
    // … up to 200 groups
  ]
}
```

Response is capped at **200 rows**, sorted by `latestAction` descending (most recent first).

**`CandidateGroup` fields:**

| Field | Type | Notes |
|---|---|---|
| `domain` | string | Canonical domain |
| `scenario` | string \| null | Null when absent from the original report context |
| `regime` | string \| null | Null when absent |
| `scopeKind` | `"check"` \| `"claim"` | Report-scope events are not surfaced as candidates |
| `scopeId` | string | The check ID or claim ID targeted |
| `parameterName` | string \| null | Null when no `parameterName` was recorded |
| `totalEvents` | number | Total feedback events in this group |
| `actions` | object | Count per action: `confirm`, `override`, `annotate` |
| `latestAction` | ISO 8601 string | Most-recent event timestamp in the group |
| `inferredValueDistribution` | object \| null | Present when the group has numeric-parseable `parameterValue`s; fields: `samples`, `min`, `max`, `median` |
| `categoricalDistribution` | object \| null | Present instead of `inferredValueDistribution` when values are non-numeric; maps value → count |
| `exampleReportIds` | string[] | Up to 5 example report IDs from the group |

**Reading the data:**

- High `override` count relative to `totalEvents` → reviewers routinely disagree with the automated check. Consider adjusting the check's threshold or evidence requirements.
- High `annotate` count with a consistent `parameterName` → a parameter is being recorded repeatedly; may indicate a missing field in the check's spec.
- High `uncertain` rate (visible via `det-read-report` on example reports) combined with high `override` → the check may lack sufficient evidence to reach a verdict autonomously.
- `inferredValueDistribution.median` → a data-driven starting point for calibrating a check's tolerance parameter.

## Error handling

| HTTP status | Error code | MCP code | Cause | Resolution |
|---|---|---|---|---|
| `400` | `invalid_request` | `-32602 InvalidParams` | `domain` query parameter is absent | Include `?domain=<canonical-domain>` in the request |
| `401` | (plain text) | `-32600 InvalidRequest` | Missing/invalid API key, or missing `feedback:read` scope (MCP) | Use a valid API key; for MCP, obtain a token with `feedback:read` |
| `500` | `internal` | `-32603 InternalError` | Repository failure (message redacted) | Retry; contact support if persistent |

## Examples

### Example 1 — HTTP query for a domain, no filters

Identify the most frequently overridden checks in `fluid-simulation` across all scenarios and regimes.

```bash
curl -sf \
  -H "Authorization: Bearer ${DETERMINISTIC_API_KEY}" \
  "https://api.yourdomain.com/api/v1/reviewer-feedback/candidates?domain=fluid-simulation" \
  | jq '.candidates | sort_by(-.actions.override) | .[:5] | .[] | {check: .scopeId, overrides: .actions.override, total: .totalEvents}'
```

Example output (abbreviated):

```jsonc
{
  "candidates": [
    {
      "domain": "fluid-simulation",
      "scenario": null,
      "regime": null,
      "scopeKind": "check",
      "scopeId": "eos-consistency",
      "parameterName": "eos_tolerance",
      "totalEvents": 34,
      "actions": { "confirm": 8, "override": 24, "annotate": 2 },
      "latestAction": "2026-05-07T18:00:00.000Z",
      "inferredValueDistribution": {
        "samples": 24,
        "min": 0.01,
        "max": 0.15,
        "median": 0.05
      },
      "exampleReportIds": ["5f1c6e9e-…", "a2b3c4d5-…"]
    }
  ]
}
```

**Interpretation:** `eos-consistency` has been overridden 24 times out of 34 events. The median override tolerance is `0.05`. This pattern suggests the check's default tolerance is tighter than what reviewers accept in practice. The `eos_tolerance` parameter could be a candidate for a rule-set calibration update.

---

### Example 2 — MCP query with scenario and regime filter

An agent checks whether `reynolds-number-regime` has a history of overrides in laminar lid-driven-cavity runs specifically.

```jsonc
// MCP request
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "list-feedback-candidates",
    "arguments": {
      "domain": "fluid-simulation",
      "scenario": "lid-driven-cavity-Re100",
      "regime": "laminar"
    }
  }
}

// Success response (abbreviated)
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [{ "type": "text", "text": "3 candidate groups for fluid-simulation / lid-driven-cavity-Re100 / laminar." }],
    "structuredContent": {
      "candidates": [
        {
          "domain": "fluid-simulation",
          "scenario": "lid-driven-cavity-Re100",
          "regime": "laminar",
          "scopeKind": "check",
          "scopeId": "reynolds-number-regime",
          "parameterName": null,
          "totalEvents": 7,
          "actions": { "confirm": 6, "override": 0, "annotate": 1 },
          "latestAction": "2026-05-06T09:15:00.000Z",
          "inferredValueDistribution": null,
          "categoricalDistribution": null,
          "exampleReportIds": ["c3d4e5f6-…"]
        }
      ]
    }
  }
}
```

**Interpretation:** `reynolds-number-regime` has 6 confirms and 0 overrides for this scenario/regime combination. Reviewers consistently agree with the automated verdict here — no calibration needed for this slice.

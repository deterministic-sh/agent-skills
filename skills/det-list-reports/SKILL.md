---
name: det-list-reports
description: >-
  List historical validation reports with optional filters for domain, status,
  and date range. Use when an agent needs to retrieve a paginated list of past
  validation reports, filter reports by outcome (pass/fail/uncertain/errored),
  or iterate through all reports for a given time window. Trigger phrases:
  "list reports", "show my reports", "find failed validations", "get reports
  for last week", "paginate through reports", "how many validations passed".
  Do NOT use when fetching a single report by ID — use
  GET /api/v1/reports/:id for that. This skill covers the HTTP transport only;
  there is no CLI list command and no MCP tool for listing.
---

# det-list-reports

Retrieve a paginated, owner-scoped list of historical validation reports using `GET /api/v1/reports`.

## When to use

**Use when:**
- Listing past validation reports with optional filtering by domain, status, or date range.
- Paginating through a large result set using cursor-based navigation.
- Checking the aggregate outcome of recent validation runs.

**Do not use when:**
- Fetching the full detail of a single known report — call `GET /api/v1/reports/:id` directly.
- Listing is needed via MCP or CLI — this endpoint is HTTP only.

## Transport

HTTP only. There is no equivalent CLI command or MCP tool for listing reports.

## Prerequisites

- `$DETERMINISTIC_API_KEY` set to a valid API key (format: `det_live_<key-id>_<secret>`).
- The key must have been issued by the account that owns the reports you want to list.

## Authentication

All requests require an API-key bearer token:

```http
Authorization: Bearer $DETERMINISTIC_API_KEY
```

No `Content-Type` header is needed for GET requests. Do not send a request body — a non-empty body is rejected with `400 invalid_request`.

## Endpoint

```
GET https://deterministic.app/api/v1/reports
```

### Query parameters

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `domain` | string | no | Exact match, e.g. `fluid-simulation`. Pattern: `[a-z0-9_-]+`, max 64 chars. |
| `status` | string | no | One of `pass`, `fail`, `uncertain`, `not_run`, `errored`. `errored` covers service-failure rows; the other four mirror `ValidationReport.summary.overall_status`. |
| `from` | ISO-8601 timestamp | no | Inclusive lower bound on `createdAt`. |
| `to` | ISO-8601 timestamp | no | Inclusive upper bound on `createdAt`. |
| `cursor` | string | no | Opaque cursor from a previous response's `nextCursor`. Do not parse or construct cursors manually. |
| `limit` | integer | no | Page size. Default `20`. Min `1`, max `100`. |

Any validation failure on any parameter returns `400 invalid_request`. Per-field error detail is intentionally not exposed on this endpoint.

### Response shape

```jsonc
{
  "reports": [
    {
      "id": "8d4a…",
      "domain": "fluid-simulation",
      "status": "pass",
      "createdAt": "2026-05-22T18:13:09.000Z",
      "checkCounts": {
        "pass": 12,
        "fail": 0,
        "uncertain": 0,
        "not_run": 0,
        "timeout": 0,
        "errored": 0,
        "total": 12
      },
      "falseConfidenceRate": null
    }
  ],
  "nextCursor": "eyJ0Ijox…"
}
```

`nextCursor` is `null` when there are no more rows. When present, replay the same request with `?cursor=<nextCursor>` appended (keep all other parameters the same).

Rows are returned in `(createdAt DESC, id DESC)` order — newest first.

`falseConfidenceRate` is reserved and always `null` in the current API version.

## Rate limit

600 requests per minute per owner across all auth modes. Rejections return `429 rate_limited` with a `Retry-After` header indicating the wait in seconds.

## Retention note

The listing endpoint reads from the `report_summary` projection, which is pruned after 90 days by default. Reports older than the retention window are not returned by this endpoint but remain accessible individually via `GET /api/v1/reports/:id`.

## Error codes

| HTTP | Code | Cause |
|---|---|---|
| 400 | `invalid_request` | Any query-parameter validation failure, or non-empty GET body. |
| 401 | `unauthorized` | Missing or invalid API key, or MCP-source actor. |
| 429 | `rate_limited` | Per-owner cap exceeded. Read `Retry-After`. |
| 500 | `internal` | Repository or database failure. |

## Examples

### Example 1 — List the 20 most recent reports

```bash
curl -s \
  -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
  "https://deterministic.app/api/v1/reports" | jq .
```

### Example 2 — Filter failed reports in a date range, paginate

First page:

```bash
curl -s \
  -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
  "https://deterministic.app/api/v1/reports?status=fail&from=2026-05-01T00:00:00Z&to=2026-05-31T23:59:59Z&limit=50" \
  | jq .
```

If the response includes `"nextCursor": "eyJ0Ijox…"`, fetch the next page:

```bash
curl -s \
  -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
  "https://deterministic.app/api/v1/reports?status=fail&from=2026-05-01T00:00:00Z&to=2026-05-31T23:59:59Z&limit=50&cursor=eyJ0Ijox…" \
  | jq .
```

Continue until `nextCursor` is `null`.

### Example 3 — List all errored validations for a specific domain

```bash
curl -s \
  -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
  "https://deterministic.app/api/v1/reports?domain=fluid-simulation&status=errored" \
  | jq '.reports[] | {id, createdAt}'
```

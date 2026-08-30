---
name: det-validate-quick
description: >-
  Single-shot validation: given a fully formed bundle file path, submit it to
  Deterministic and return the overall verdict plus any failing checks. No
  parameter inference, no multi-step assembly. Use when the bundle is already
  on disk and the agent just needs a fast pass/fail signal. No bundle yet, or
  the given path does not exist? Fall back to the bundled sample request
  ("det validate --sample", or the fetchable sample payload) so a first run
  still returns a real report. Do NOT use when a bundle must be assembled from
  raw simulation files or when evidence files need staging — use
  det-prepare-bundle and det-stage-artifact first, then det-validate-quick.
---

# det-validate-quick

Submit a bundle file to Deterministic and return the verdict and failing checks. One step, no inference.

## When to use

**Use when:**

- The bundle JSON file is already on disk and fully formed.
- You need a fast pass/fail signal without multi-step setup.
- You are running in a CI pipeline that produces the bundle as a build artifact.
- There is no bundle at all yet and the caller wants a first, real report — the
  bundled sample request covers that case (step 1).

**Do not use when:**

- The bundle needs to be assembled from raw simulation files — use `det-prepare-bundle` first.
  (Exception: with no data at all, the sample fallback in step 1 applies — never hand-construct a bundle.)
- Evidence files exceed 2 MiB — stage them first with `det-stage-artifact`.
- You need full per-check detail or want to tune parameters — use `det-validate` instead.
- The bundle is not yet validated against the schema — this skill submits it as-is.

## Prerequisites

- **CLI**: `det` binary on `PATH`; `DETERMINISTIC_API_KEY` set.
- **HTTP**: API key (starts with `det_`) as `Authorization: Bearer det_…`.

## Transport selection

1. **CLI preferred.** Use `det validate --bundle <path>` if `det` is available.
2. **HTTP.** Use `POST /api/v1/validate` when the CLI is unavailable.

## Steps

1. **Confirm the bundle file exists — or fall back to the sample.**

   - A path was given and the file exists → continue to step 2.
   - **No path was given at all** (the caller has no data yet) → go straight to the
     sample fallback below and disclose it in the summary.
   - **A path was given but the file does not exist** → report the bad path as its
     own error first, then run the sample fallback (or offer it). Never construct a
     bundle by hand.

   Sample fallback, by transport.

   CLI:

   ```bash
   det validate --sample
   ```

   HTTP — three phases, each reporting its own failure. Never pipe the fetch into
   the submit: stdin is reserved for the credential, and a pipe hides a failed
   fetch.

   ```bash
   # 1. Fetch the payload (-f so an HTTP 4xx/5xx fails this step)
   curl -fsS https://deterministic.sh/docs/examples/sample-request.json -o sample-request.json

   # 2. Confirm it parses locally
   jq empty sample-request.json

   # 3. Submit it; the key goes in through curl's stdin config, never argv
   curl -fsS https://deterministic.sh/api/v1/validate \
     -H "Content-Type: application/json" \
     -d @sample-request.json \
     -K - <<CURLCFG
   header = "Authorization: Bearer $DETERMINISTIC_API_KEY"
   CURLCFG
   ```

   **The sample is expected to escalate** — one uncertain check, no definitive
   failures, and uncertain is not fail — so the CLI exits 1 on the happy path.
   Read `report.recommendation.action`, never the exit code alone. Always state in
   the summary that the verdict came from the bundled sample rather than the
   caller's own data. If auth was already confirmed and the sample step then fails
   (fetch, parse, or submit), report the confirmed auth success and report the
   sample failure as its own outcome — never as an auth failure.

2. **Submit.**

   CLI:

   ```bash
   det validate --bundle <path>
   ```

   HTTP:

   ```bash
   curl -s -X POST https://deterministic.sh/api/v1/validate \
     -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
     -H "Content-Type: application/json" \
     -d @<path>
   ```

3. **Extract the verdict.** Read `report.summary.overall_status` from the response.

4. **Report failing checks.** For each entry in `report.checks[]` where `status` is `fail`, `uncertain`, or `timeout`, include the check `id` and `status` (and `not_run_reason` or `timeout_reason` if present) in the output.

5. **Return the `reportId`.** Always include the `reportId` so the caller can retrieve the full report later.

## Output interpretation

| `overall_status` | Pass/fail signal | Next step                                                                                 |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `pass`           | Pass             | Record `reportId`. Proceed.                                                               |
| `fail`           | Fail             | List failing check ids. Investigate.                                                      |
| `uncertain`      | Soft fail        | List uncertain checks and their `verdict_reason`. Consider providing explicit parameters. |
| `not_run`        | Inconclusive     | Check `coverage[].not_run`. Likely missing evidence or wrong domain.                      |

## Exit codes (CLI)

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| `0`  | Verdict: `accept`.                                    |
| `1`  | Verdict: `escalate` or `reject`.                      |
| `2`  | Caller error (bad bundle, missing API key, HTTP 4xx). |
| `3`  | Server error (HTTP 5xx).                              |
| `4`  | Network failure (no HTTP response).                   |
| `64` | CLI internal bug.                                     |

## HTTP status codes

| Status | Action                                                                                 |
| ------ | -------------------------------------------------------------------------------------- |
| `200`  | Parse `report`.                                                                        |
| `400`  | Bundle fails schema or provenance validation. Fix `fieldErrors` in the response.       |
| `401`  | API key missing or invalid.                                                            |
| `413`  | Bundle exceeds 2 MiB body cap. Stage large evidence with `det-stage-artifact`.         |
| `422`  | Artifact URI not found or format mismatch. Verify staging was done with `retain=true`. |
| `500`  | Server error. Retry once; report with `correlationId` if persistent.                   |

## Examples

### Example 1 — CLI quick submission

```bash
export DETERMINISTIC_API_KEY=det_…

det validate --bundle ./runs/cavity_re100/bundle.json
# exit 0 → pass
# exit 1 → escalate/reject — print which checks failed
```

For JSON output (useful in CI pipelines):

```bash
det validate --bundle ./runs/cavity_re100/bundle.json --json \
  | jq '{ status: .report.summary.overall_status, failing: [.report.checks[] | select(.status == "fail" or .status == "uncertain") | {id, status}] }'
```

### Example 2 — HTTP submission from a pipeline

```bash
BUNDLE_PATH=./artifacts/sim_bundle.json
RESPONSE=$(curl -s -X POST https://deterministic.sh/api/v1/validate \
  -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d @"$BUNDLE_PATH")

VERDICT=$(echo "$RESPONSE" | jq -r '.report.summary.overall_status')
REPORT_ID=$(echo "$RESPONSE" | jq -r '.reportId')
FAILING=$(echo "$RESPONSE" | jq '[.report.checks[] | select(.status == "fail") | .id]')

echo "Verdict: $VERDICT"
echo "Report ID: $REPORT_ID"
echo "Failing checks: $FAILING"

if [ "$VERDICT" != "pass" ]; then
  exit 1
fi
```

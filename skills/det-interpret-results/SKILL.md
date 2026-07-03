---
name: det-interpret-results
description: >-
  Analyze a fetched Deterministic validation report and produce actionable
  decisions: whether to ship, what failed and why, what to fix first, and what
  coverage gaps exist. Use when you already have a report object and need to
  decide what to do next. This skill is local-only — it performs no network
  calls and requires no API credentials. Do NOT use to fetch the report — call
  det-read-report first. Do NOT use when the report is not yet available.
---

# det-interpret-results

Analyze a Deterministic validation report and answer the four standard post-validation questions: is it safe to ship, what failed and why, what to fix first, and what coverage is missing.

## When to use

**Use when:**
- You have a `ReportResponse` from `det-read-report` (or from the `structuredContent` of an MCP `validate` / `read-report` call) and need to decide next steps.
- You want a prioritized list of failures and remediation actions.
- You need to summarize coverage gaps (checks that did not run or reached `uncertain`).

**Do not use when:**
- You do not yet have a report — call `det-read-report` first.
- You need to fetch a report from the API — this skill makes no network calls.

## Prerequisites

- A `ReportResponse` object. Either passed directly by the caller, or obtained by running `det-read-report`.
- No network access, no API credentials required.

## Steps

1. **Read `report.summary.overall_status` and `report.recommendation.action`.** These are the top-level verdicts. Derive the ship decision from them (see table below).

2. **Collect failing checks.** Filter `checks[]` where `status === "fail"`. List all failures — there is no severity field on checks.

3. **Collect uncertain and not-run checks.** These represent coverage gaps — places where the engine could not reach a verdict or chose not to run.

4. **Identify timeout checks.** Checks with `status === "timeout"` are treated as `uncertain` for claim derivation but are a distinct signal: they indicate the check started but exceeded its time budget. Note both `expected_ms` and `timeout_reason` if present.

5. **Map check IDs to domain-specific meaning.** Use the check `id`, `message`, and `evidence` fields to explain what the failure means in terms the caller's domain.

6. **Produce a prioritized action list.** Order: `fail` checks first → `uncertain` items requiring human review → coverage gaps (`not_run` and `timeout`).

7. **Answer the four standard questions** (see Output section below).

## Ship decision table

| `report.summary.overall_status` | `report.recommendation.action` | Decision |
|---|---|---|
| `pass` | `accept` | Safe to treat results as validated. Proceed. |
| `fail` | `reject` | Do not ship. Fix failing checks and re-validate. |
| `uncertain` | `escalate` | Do not ship without human review. Route to a reviewer. |

## Per-check status → action mapping

| Check status | Action |
|---|---|
| `pass` | No action needed. |
| `fail` | Block shipment. Fix the underlying issue and re-validate. A reviewer may override with `det-submit-feedback` if appropriate. |
| `uncertain` | Do not treat as passing. Either supply more evidence and re-validate, or route for human review via `det-submit-feedback`. |
| `not_run` | Note the gap. This check was not applicable to the current domain/regime, or a prerequisite check failed. No action required unless the gap represents a coverage concern you care about. |
| `timeout` | Treat as `uncertain`. The check exceeded its budget. May indicate a large or complex evidence input; consider splitting evidence or contacting support if it recurs. |

## Output format

Produce a structured analysis covering:

### 1. Ship decision

A single sentence stating whether the results are safe to ship, and why.

### 2. What failed and why

For each failing check:
- Check ID and status
- What the check tests (inferred from `id` and `message`)
- The specific finding from `message`
- Which evidence items were involved (`evidence[]`)

### 3. What to fix first

The most impactful failing check (based on `id` and `message`), with a brief description of the likely root cause and what kind of change would address it.

### 4. Coverage gaps

List every check with `status === "not_run"` or `status === "uncertain"` or `status === "timeout"`, with the reason where known. Flag if any critical coverage area is missing.

## Examples

### Example 1 — Fail with two critical checks

**Input report summary:**
```jsonc
{
  "summary": {
    "overall_status": "fail",
    "definitive_passes": 2,
    "definitive_failures": 2,
    "uncertain": 0,
    "not_run": 1,
    "timeouts": 0
  },
  "recommendation": { "action": "reject" },
  "checks": [
    {
      "id": "reynolds-number-regime",
      "status": "fail",
      "message": "Computed Re=3800 exceeds laminar threshold (2300). Declared regime 'laminar' is inconsistent with the evidence.",
      "evidence": ["centerline_velocity"]
    },
    {
      "id": "pressure-continuity",
      "status": "fail",
      "message": "Pressure residual did not converge: final residual 1.2e-2 exceeds threshold 1e-4.",
      "evidence": ["residuals"]
    },
    { "id": "mass-conservation", "status": "pass" },
    { "id": "symmetry-plane", "status": "pass" },
    { "id": "turbulence-intensity", "status": "not_run" }
  ]
}
```

**Analysis output:**

**Ship decision:** Do not ship. Two checks failed; the declared flow regime is inconsistent with the computed Reynolds number.

**What failed and why:**
1. `reynolds-number-regime` [fail] — This check verifies that the declared `operating_regime` matches the Reynolds number computed from the evidence. The bundle declares `laminar` but the computed Re (3800) is in the transitional-to-turbulent range (above 2300). The result is internally inconsistent and cannot be treated as a validated laminar simulation.
2. `pressure-continuity` [fail] — This check verifies that the solver reached a converged pressure field. The final residual (1.2e-2) is two orders of magnitude above the required threshold (1e-4). Unconverged pressure fields can produce locally plausible but globally incorrect velocity distributions.

**What to fix first:** Correct the flow regime declaration or re-run the simulation at an appropriate Reynolds number. If the simulation is intentionally turbulent, update `context.operating_regime` to `turbulent` in the bundle and re-validate. Do not proceed to convergence fixes until the regime is consistent — some convergence checks change behavior under different regimes.

**Coverage gaps:**
- `turbulence-intensity` [not_run] — skipped because the declared regime is `laminar`. This gap will resolve once the regime inconsistency is corrected.

---

### Example 2 — Pass with one uncertain check

**Input report summary:**
```jsonc
{
  "summary": {
    "overall_status": "uncertain",
    "definitive_passes": 5,
    "definitive_failures": 0,
    "uncertain": 1,
    "not_run": 0,
    "timeouts": 0
  },
  "recommendation": { "action": "escalate" },
  "checks": [
    { "id": "mass-conservation", "status": "pass" },
    { "id": "reynolds-number-regime", "status": "pass" },
    { "id": "pressure-continuity", "status": "pass" },
    { "id": "symmetry-plane", "status": "pass" },
    { "id": "boundary-layer-resolution", "status": "pass" },
    {
      "id": "eos-consistency",
      "status": "uncertain",
      "message": "Equation-of-state consistency could not be determined: density evidence item is absent. Provide 'density_field' evidence to resolve.",
      "evidence": []
    }
  ]
}
```

**Analysis output:**

**Ship decision:** Do not ship without human review. All checks passed except `eos-consistency`, which reached `uncertain` due to missing evidence. The overall recommendation is `escalate`.

**What failed and why:** No checks failed outright.

**Uncertain checks requiring attention:**
- `eos-consistency` [uncertain] — The check needs a `density_field` evidence item to verify equation-of-state consistency. The evidence item was absent from the bundle. Either add the density field evidence and re-validate, or have a reviewer confirm it is not applicable for this simulation via `det-submit-feedback`.

**What to fix first:** Add a `density_field` evidence item to the bundle (or supply it as a staged artifact) and re-submit. If density is not available, route to a human reviewer with `det-submit-feedback` using `action: "annotate"` and a note explaining why the field is absent.

**Coverage gaps:** None beyond the uncertain check documented above.

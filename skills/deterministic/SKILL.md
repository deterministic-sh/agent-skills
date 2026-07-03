---
name: deterministic
description: >-
  Primary entry point for the Deterministic validation platform. Use when an
  agent or user wants to validate simulation output, check results, submit
  reviewer feedback, set up auth, troubleshoot errors, or do anything else
  with Deterministic. Routes natural-language intent to the appropriate
  det-* sub-skill: det-extract, det-validate, det-validate-quick,
  det-prepare-bundle, det-stage-artifact, det-read-report,
  det-interpret-results, det-submit-feedback, det-feedback-candidates,
  det-auth, det-list-reports, det-onboard, det-troubleshoot.
---

# deterministic

Primary entry point for the Deterministic validation platform. Routes natural-language intent to the appropriate `det-*` sub-skill.

## When to use

Use this skill when the user mentions Deterministic, validation, simulation checks, evidence bundles, reports, reviewer feedback, or any related concept — and the exact sub-skill is not specified. This skill dispatches; the sub-skills execute.

Triggers include but are not limited to: "validate", "check this run", "is this safe to ship", "fetch report", "interpret results", "submit feedback", "list my reports", "log in", "set up", "error", "401", "what does exit code mean", "I'm new to deterministic", "help me get started".

## How it works

1. Read the user's intent.
2. Match against the routing table below.
3. Invoke the target `det-*` sub-skill.
4. If intent is exploratory or first-time → invoke `det-onboard`.
5. If intent is concrete but ambiguous between non-onboarding skills → ask one clarifying question, then route.

This skill does not implement validation logic, API calls, or parameter inference. Those live in the sub-skills. Read the sub-skill's `SKILL.md` for execution details.

## Routing table

| User intent | Trigger phrases | Target sub-skill |
|---|---|---|
| Extract from sim output | "convert my VTK/VTU", "extract a surface/probe to parquet", "make an evidence extract from my CFD output" | `det-extract` |
| Submit / validate | "validate", "check this", "run deterministic on", "verify", "submit for validation" | `det-validate` |
| Quick submit | "quick check", "single-shot validate", "just run the bundle" | `det-validate-quick` |
| Prepare bundle | "prepare a bundle", "build evidence", "assemble validation request", "what should I include in the bundle" | `det-prepare-bundle` |
| Stage artifact | "upload a large file", "stage evidence", "this file is over 2 MiB" | `det-stage-artifact` |
| Read report | "fetch report", "show me report X", "get report by ID" | `det-read-report` |
| Interpret results | "is this safe to ship", "what failed", "what do these results mean", "should I block on this", "interpret these results" | `det-interpret-results` |
| List reports | "list reports", "show recent runs", "what have I submitted" | `det-list-reports` |
| Submit feedback | "submit feedback", "override this check", "confirm this verdict", "annotate" | `det-submit-feedback` |
| Feedback stats | "feedback candidates", "rule tuning data", "what checks are overridden" | `det-feedback-candidates` |
| Auth | "log in", "log out", "set my API key", "who am I", "auth setup" | `det-auth` |
| Onboard | "first time", "get started", "set up deterministic", "help me start", "what is deterministic", "help", "what can you do" | `det-onboard` |
| Troubleshoot | "error", "not working", "failing", "401", "rate limited", "exit code", "what does this error mean" | `det-troubleshoot` |

## Routing rules

**Routing is based on intent, not execution context.** A user saying "validate this run" routes to `det-validate` regardless of whether credentials are present. Missing credentials are handled by the target skill (which checks `$DETERMINISTIC_API_KEY` and surfaces auth errors), or by routing to `det-auth` only when the user explicitly asks for auth setup.

**Multi-step flows** dispatch in sequence. Examples:
- "validate this and tell me if it's safe" → `det-validate` → `det-interpret-results`
- "fetch report X and tell me what to fix" → `det-read-report` → `det-interpret-results`
- "submit feedback overriding the regime check" → ensure the report exists (use `det-read-report` if needed) → `det-submit-feedback`

**Exploratory or first-time intent** routes to `det-onboard`. This includes "what is this", "help", "what can you do", "I'm new", "tell me about deterministic".

**Concrete but ambiguous intent** (e.g., "I have a validation question") gets one clarifying question, then routes:

> "I can help with: submitting validation runs (validate), reading/interpreting reports (read/interpret), managing auth (auth), or troubleshooting errors (troubleshoot). Which one?"

Reserve the clarifying question for genuine ambiguity between concrete intents. Do not use it as a default for every unmatched phrase.

## What this skill does NOT do

- Does NOT implement parameter inference (see `det-prepare-bundle`, `det-validate`).
- Does NOT call the HTTP API, CLI, or MCP tools directly (sub-skills do).
- Does NOT duplicate error tables, response shapes, or auth flows (sub-skills do).
- Does NOT pick the transport (CLI vs HTTP vs MCP) — each sub-skill handles its own transport selection.

## Examples

### Example 1 — Clear intent

User: "validate this simulation"

Routing: `det-validate`. Invoke that skill, which will infer parameters, pick transport, and submit.

### Example 2 — Multi-step

User: "fetch report 7c8a9f12-... and tell me if I can ship"

Routing:
1. `det-read-report` with `reportId = 7c8a9f12-...`
2. `det-interpret-results` on the returned report

### Example 3 — Exploratory

User: "what does deterministic do"

Routing: `det-onboard`. The onboarding skill explains the platform and offers a test validation.

### Example 4 — Concrete but ambiguous

User: "I have a problem with my validation"

Response: "I can help with: submitting validation runs (validate), reading/interpreting reports (read/interpret), managing auth (auth), or troubleshooting errors (troubleshoot). Which one?"

User: "it returned a 401"

Routing: `det-troubleshoot`.

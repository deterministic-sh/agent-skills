---
name: det-onboard
description: >-
  First-run setup guide for new Deterministic users. Use when a user is
  starting with Deterministic for the first time and needs to verify
  installation, configure credentials, and understand which skills to use for
  each phase of the validation workflow. Trigger phrases: "get started with
  deterministic", "set up deterministic", "first time using deterministic",
  "how do I use deterministic", "I just got a deterministic API key", "where do
  I start", "onboard me to deterministic". Do NOT use when the user already has
  working credentials and is experiencing errors — use det-troubleshoot
  instead. Do NOT use for internal developer setup of the Deterministic
  codebase itself.
---

# det-onboard

Walk through the first-time setup for Deterministic: verify the CLI installation, configure credentials, and understand the available skills for each phase of the validation workflow.

## When to use

**Use when:**
- Starting with Deterministic for the first time.
- Missing CLI or credentials and unsure how to set them up.
- Wanting an overview of which skill to use at each step.

**Do not use when:**
- Credentials are already configured and a specific command is failing — use det-troubleshoot.
- Setting up the Deterministic application codebase itself (developer context).

## Transports

This onboarding skill covers both CLI and HTTP. Step 1–3 guide CLI installation and auth; the skill overview in Step 4 covers all transports.

## Steps

### Step 1 — Verify the CLI is installed

```bash
det --version
```

If the command is not found:

1. Install the CLI globally (published with npm provenance; verify with
   `npm audit signatures` if desired):

   ```bash
   npm install -g @deterministic-sh/cli
   ```

2. Confirm it is on `$PATH`:

   ```bash
   which det
   det --version
   ```

   (Working inside the Deterministic monorepo itself? The in-repo build also
   works: `npm run build -w @deterministic-sh/cli`, then substitute
   `node <repo-root>/packages/cli/dist/cli.js` for `det` in later steps.)

The CLI is not required for HTTP or MCP integrations; skip to Step 2 if you are only using those transports.

### Step 2 — Check for existing credentials

Check whether an API key is already configured:

```bash
# Check for environment variable (presence only — never print the full key)
[ -n "$DETERMINISTIC_API_KEY" ] && echo "DETERMINISTIC_API_KEY is set" || echo "DETERMINISTIC_API_KEY is not set"

# Check for credentials file
det auth whoami
```

If `det auth whoami` prints a host, key, and source — credentials are ready. Skip to Step 4.

If either shows nothing or an error, continue to Step 3.

### Step 3 — Configure credentials

**Option A — environment variable (recommended for CI and agent environments)**

```bash
export DETERMINISTIC_API_KEY=det_live_<key-id>_<secret>
```

Verify it is active:

```bash
det auth whoami
# source: env
```

**Option B — credentials file (recommended for interactive use)**

```bash
det auth login
# Host [https://deterministic.app]: <Enter>
# API key: (no echo)
# Saved credentials to ~/.config/deterministic/credentials.json
```

Verify:

```bash
det auth whoami
# source: file
```

To obtain an API key, visit the Deterministic dashboard at `https://deterministic.app`.

Do not put the API key in a URL, shell history line, or script argument. Use the environment variable or the credentials file.

### Step 4 — Available skills and their purpose

Use these skills for each phase of the validation workflow:

| Skill | Transport | Use for |
|---|---|---|
| `det-auth` | CLI | Configure, verify, or clear API credentials. |
| `det-prepare-bundle` | local (no network) | Assemble a `ValidationRequest` JSON bundle from simulation output files. |
| `det-stage-artifact` | HTTP | Upload evidence files larger than 2 MiB before submitting a bundle. |
| `det-validate` | CLI / HTTP / MCP | Submit a validation bundle and receive a structured report. |
| `det-validate-quick` | CLI / HTTP | Submit a minimal bundle for rapid spot-checking. |
| `det-list-reports` | HTTP | List and filter historical validation reports. |
| `det-troubleshoot` | CLI / HTTP / MCP | Diagnose errors, decode exit codes, and handle rate limits. |

The primary workflow for most agents is: `det-prepare-bundle` → (optional `det-stage-artifact` for large files) → `det-validate` → inspect report.

### Step 5 — Run a test validation

Once credentials are configured, verify end-to-end connectivity with a minimal bundle. Save this to `test-bundle.json`:

```json
{
  "version": "0.1",
  "domain": "fluid-simulation",
  "mode": "instant",
  "context": {
    "scenario": "onboard-check",
    "method": "FVM",
    "operating_regime": "laminar",
    "time_basis": "steady",
    "claimed_units": { "velocity": "m/s" }
  },
  "evidence": [
    {
      "id": "e1",
      "kind": "scalar",
      "role": "primary_result",
      "format": "json",
      "schema": { "u": "number" },
      "value": [{ "u": 0.22 }]
    }
  ],
  "claims": [
    {
      "id": "c1",
      "kind": "range",
      "subject": "e1.u",
      "expectation": "velocity is in a physically plausible range"
    }
  ]
}
```

Submit it:

```bash
det validate --bundle test-bundle.json --pretty
```

A `pass`, `fail`, or `uncertain` result all confirm the connection and credentials are working. An exit code of `2` or `4` indicates an auth or network issue — use det-troubleshoot.

## Examples

### Example 1 — Full first-time setup with CLI

```bash
# Step 1: verify CLI
det --version

# Step 2: no credentials yet
det auth whoami  # exits 2

# Step 3: configure via env var
export DETERMINISTIC_API_KEY=det_live_k7m4n9_<secret>
det auth whoami
# host: https://deterministic.app
# api key: det_live_k7m4n9_<redacted>
# source: env

# Step 5: test validation
det validate --bundle test-bundle.json --pretty
```

### Example 2 — HTTP-only setup (no CLI required)

```bash
# Step 2: check env var (presence only)
[ -n "$DETERMINISTIC_API_KEY" ] && echo "set" || echo "not set"

# Step 3: set it if missing (replace with your actual key)
export DETERMINISTIC_API_KEY="$YOUR_API_KEY"

# Step 5: test with curl
curl -s \
  -H "Authorization: Bearer $DETERMINISTIC_API_KEY" \
  -H "Content-Type: application/json" \
  -d @test-bundle.json \
  "https://deterministic.app/api/v1/validate" | jq '.report.summary'
```

A `200 OK` with `summary.overall_status` confirms connectivity.

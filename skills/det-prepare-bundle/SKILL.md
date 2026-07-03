---
name: det-prepare-bundle
description: >-
  Assemble a valid Deterministic ValidationRequest JSON bundle from simulation
  context. Use when an agent needs to prepare a bundle before calling
  det-validate, when it has simulation output files but no pre-built bundle,
  or when it needs to infer domain and context fields from file extensions and
  solver metadata. Do NOT use when the bundle is already fully formed — go
  directly to det-validate. Do NOT use to actually submit the request; this
  skill is local-only and produces no network traffic.
---

# det-prepare-bundle

Assemble a `ValidationRequest` JSON bundle from available simulation context, inferring fields where possible and declaring provenance for every inferred value.

## When to use

**Use when:**
- You have simulation output files but no pre-built bundle.
- You need to infer `domain`, `context`, or `mode` from file extensions, config files, or solver output.
- You are about to call `det-validate` and want a validated, well-formed bundle first.

**Do not use when:**
- The bundle JSON is already complete and passes schema — go straight to `det-validate`.
- You are uploading large evidence files (>2 MiB) — use `det-stage-artifact` for those, then reference the artifact URIs in the bundle.

## Prerequisites

- No network access required. This skill is local-only.
- `ValidationRequestSchema` reference: `packages/validation-engine/src/request.ts`.

## Steps

1. **Scan available files.** List extensions and filenames in the working directory or the directory specified by the caller.

2. **Infer domain.** Match extensions to a domain:
   - `.foam`, `.cas`, `.dat`, `.vtk`, `openfoam*`, `fluent*`, `case/` directory → `fluid-simulation`
   - If no match, ask the caller to specify `domain` explicitly before continuing.

3. **Set `mode`.** Use `instant` by default. Switch to `flag` only if the caller explicitly requests reviewer escalation. Do not use `gate` (reserved, rejected at service time).

4. **Infer `context` fields** from solver config, log files, or filenames. For each field you infer rather than read directly, record a `context_provenance` entry.

5. **Collect `evidence` items.** For each result file:
   - Assign a short, stable `id` (e.g. `centerline_velocity`).
   - Set `kind`: `series` for 1D indexed results, `table` for multi-column data, `scalar` for single values.
   - Set `role`: one of `primary_result` (main output), `derived_state` (residuals, convergence history), `reference` (published/expected data), or `baseline` (comparison baseline).
   - Set `format`: `json` for inline values; `csv`, `parquet`, or `hdf5` for file-backed artifacts. Omit `format` to let the engine detect it from byte signature (the engine reads the first 1024 + last 16 bytes).
   - Keep `value` inline only if the total bundle will remain under 2 MiB. For larger files, plan to use `det-stage-artifact` and replace `value` with a `uri` field.

6. **Formulate `claims`.** Each claim needs:
   - A unique `id`.
   - `kind`: `range`, `invariant`, `comparative`, `temporal`, or `consistency`.
   - `subject`: dot-path into the evidence item (e.g. `centerline_velocity.u`).
   - `expectation`: a plain English statement of what should hold.

7. **Build `context_provenance` array.** Include one entry per field you inferred (not read directly from a config file or the caller). See admitted paths below.

8. **Validate the bundle.** Check the constructed object against `ValidationRequestSchema`. Fix any `fieldErrors` before returning.

9. **Return the bundle JSON** to the caller for review or direct handoff to `det-validate`.

## Parameter inference heuristics

| Signal | Inferred field | Notes |
|---|---|---|
| `turbulenceProperties` / `RASModel` / `LESModel` in config | `context.operating_regime` = `turbulent` | |
| `Re < 2300` from log or `laminarFlow` keyword | `context.operating_regime` = `laminar` | |
| `steady` in solver name or `steadyState` time scheme | `context.time_basis` = `steady` | |
| `transient` or `pimple`/`piso` in solver name | `context.time_basis` = `transient` | |
| `fvSolution`, `blockMesh`, `snappyHexMesh` | `context.method` = `FVM` | |
| `μ` / `nu` value found in `transportProperties` | `context.parameters.kinematic_viscosity` | |
| `ρ` / `rho` value found in `thermophysicalProperties` | `context.parameters.density` | |

## `context_provenance` — admitted paths and tags

When a field value was inferred by you (the agent) rather than explicitly provided by the caller or directly parsed from a config file with no ambiguity, declare it.

**Admitted paths** (any other path is rejected with `400 invalid_context_provenance_path`):

| Category | Paths |
|---|---|
| Verdict-affecting | `context.method`, `context.operating_regime` |
| Descriptive | `context.scenario`, `context.time_basis` |
| Physical parameters | `context.parameters.dynamic_viscosity`, `context.parameters.kinematic_viscosity`, `context.parameters.density` |

**Tags:**
- `llm_inferred` — you derived the value from heuristics or pattern matching.
- `llm_normalized` — the caller stated a value but you converted or canonicalized it (e.g. "Laminar" → `laminar`).

**NOT admitted for provenance** (do not declare provenance entries for these):
- `context.fluid_id`
- `context.result_source`
- `context.claimed_units.*`
- Any path not in the admitted set above.

At most 32 entries. Same-path entries must agree on `tag`; conflicting-tag duplicates are rejected. Same-tag duplicates collapse silently.

## File denylist

Never include any of the following in `evidence.value` or reference them in a bundle:

- `.env`, `*.env.*`
- `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx`
- `credentials.json`, `secrets.json`, `*.secret`
- SSH private keys (`id_rsa`, `id_ed25519`, etc.)
- Any file whose name contains `secret`, `password`, `token`, or `credential`

If a file on the denylist appears to contain simulation data, ask the caller to rename or extract the relevant data to a neutral file first.

## Output interpretation

The bundle is ready when:
- `ValidationRequestSchema` parse succeeds with no `fieldErrors`.
- All inferred fields have a corresponding `context_provenance` entry.
- No denylist files are referenced.
- Total JSON size is ≤ 2 MiB (if larger, extract heavy evidence to artifacts).

## Examples

### Example 1 — OpenFOAM lid-driven cavity, inferred regime

```json
{
  "version": "0.1",
  "domain": "fluid-simulation",
  "mode": "instant",
  "result_source": "openfoam-2406",
  "context": {
    "scenario": "lid-driven-cavity-Re100",
    "method": "FVM",
    "operating_regime": "laminar",
    "time_basis": "steady",
    "fluid_id": "air_dry",
    "claimed_units": {
      "velocity": "m/s",
      "pressure": "Pa"
    }
  },
  "context_provenance": [
    { "path": "context.operating_regime", "tag": "llm_inferred" },
    { "path": "context.time_basis", "tag": "llm_inferred" }
  ],
  "evidence": [
    {
      "id": "centerline_velocity",
      "kind": "series",
      "role": "primary_result",
      "format": "json",
      "schema": {
        "x": "number",
        "u": { "type": "number", "role": "velocity" }
      },
      "value": [
        { "x": 0.0, "u": 0.0 },
        { "x": 0.5, "u": 0.22 },
        { "x": 1.0, "u": 0.0 }
      ]
    }
  ],
  "claims": [
    {
      "id": "c1",
      "kind": "range",
      "subject": "centerline_velocity.u",
      "expectation": "centerline velocity stays within the expected laminar cavity band for Re=100"
    }
  ]
}
```

### Example 2 — Fluent turbulent pipe flow, kinematic viscosity read from file

The solver log shows `nu = 1.5e-5 m²/s` and the mesh is labeled `pipe-Re12000`. Kinematic viscosity was read directly from the config, so it does not need a provenance entry. Operating regime was inferred from `Re > 4000`, so it does.

```json
{
  "version": "0.1",
  "domain": "fluid-simulation",
  "mode": "instant",
  "result_source": "ansys-fluent-2024r1",
  "context": {
    "scenario": "pipe-Re12000",
    "method": "FVM",
    "operating_regime": "turbulent",
    "time_basis": "steady",
    "claimed_units": {
      "velocity": "m/s",
      "pressure": "Pa"
    },
    "parameters": {
      "kinematic_viscosity": 1.5e-5
    }
  },
  "context_provenance": [
    { "path": "context.operating_regime", "tag": "llm_inferred" }
  ],
  "evidence": [
    {
      "id": "axial_velocity_profile",
      "kind": "series",
      "role": "primary_result",
      "format": "csv",
      "schema": {
        "r": "number",
        "u_axial": { "type": "number", "role": "velocity" }
      },
      "uri": "r2-artifact://req_pipe_001/art_axial_profile"
    }
  ],
  "claims": [
    {
      "id": "c1",
      "kind": "range",
      "subject": "axial_velocity_profile.u_axial",
      "expectation": "axial velocity profile is consistent with fully developed turbulent pipe flow at Re=12000"
    }
  ]
}
```

Note: the CSV file referenced by the artifact URI must be uploaded first via `det-stage-artifact` before this bundle is submitted.

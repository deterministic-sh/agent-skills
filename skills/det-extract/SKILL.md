---
name: det-extract
description: >-
  Reduce native simulation output (CFD, structural or thermal) to a
  Deterministic-compliant Parquet extract plus an evidence schema sidecar,
  entirely on the local machine. Use when you have solver output and an audited
  design-partner installation of the deterministic-extract reducer, before
  det-stage-artifact and det-prepare-bundle. The reducer is not publicly
  distributed; without it, author CSV, JSON or Parquet evidence tables yourself
  and go to det-prepare-bundle. Do NOT use when you already have a compliant
  parquet/CSV extract — go straight to det-stage-artifact. Runs client-side and
  produces no network traffic; raw simulation data never leaves the machine.
---

# det-extract

Turn native solver output into a Deterministic-ready **Parquet** extract + an **evidence schema** sidecar, locally. Runs the `deterministic-extract` reducer; only the small extract leaves the machine — raw simulation data does not.

## Availability

The `deterministic-extract` reducer is available to audited design-partner installations and is not publicly distributed yet (its release is behind a pending licence gate). Without an audited installation, skip this skill: author CSV, JSON or Parquet evidence tables yourself, with explicit units, and build the request with `det-prepare-bundle` (then `det-validate`). Public reference: https://deterministic.sh/docs/cli/extract/

## Formats

Every format below is read by the design-partner reducer only. Outside an audited installation the public route is caller-authored CSV, JSON or Parquet tables.

**Mesh / CFD readers** — extracted with `--surface` or `--probe` as described in Steps:

- **VTK/VTU** (`.vtu`/`.vtp`/`.vtk`/`.pvd`) — producer-neutral; a conforming export can carry CFD, structural or thermal point fields.
- **OpenFOAM** — a serial or reconstructed case directory, or its `.foam` stub.
- **EnSight Gold** — the `.case` file (or its directory).
- **CGNS** — a `.cgns` file.
- **Fluent CFF** — `.cas.h5`/`.dat.h5` pairs.

**Native structural / thermal results:**

- **CalculiX FRD** — ASCII `.frd`; a bare `--surface` emits the nodal results of the last complete result snapshot.
- **CalculiX .dat** — buckling factors printed by `*BUCKLE`; content-detected, the `.dat` suffix alone is not trusted. `det extract` does not forward this route, so run the reducer directly: `--dat-result buckling_factors` with two required numeric declarations, `--dat-step` (the step integer printed in the `.dat`) and `--dat-modes` (the exact mode count from the caller's own `*BUCKLE` card; the declared count is what detects a truncated block). The factors are dimensionless, so this route takes no units, entity-location, averaging or coordinate-frame declarations:

  ```bash
  "${DETERMINISTIC_EXTRACT_BIN:-deterministic-extract}" job.dat --dat-result buckling_factors --dat-step 1 --dat-modes 10 --out factors.parquet
  ```

- **Nastran OP2/F06** — selected with `--op2-result` / `--f06-result` plus caller-declared subcase, units, entity location, averaging and coordinate frame.
- **ANSYS MAPDL RST/RTH** — `.rst`/`.rth`, selected with `--mapdl-result` plus a result set and caller-declarations. Untrusted `.rst`/`.rth` needs OS/container isolation.

The `det extract` page at https://deterministic.sh/docs/cli/extract/ documents the declarations for the CalculiX FRD, Nastran OP2/F06 and ANSYS MAPDL RST/RTH routes (it does not cover CalculiX .dat, above) — use the declarations listed there rather than guessing values.

## When to use

**Use when:**

- You have an audited reducer installation and solver output in one of the formats above, and need a tabular artifact to validate.
- You want a boundary-**surface** extract or a **probe/sample-line** through the field (probe is VTK/VTU and OpenFOAM only).
- The customer's data is large or proprietary and must not be uploaded raw. (EnSight Gold, CGNS and Fluent CFF read selectively — only the requested nodes/variables/zones are paged in.)

**Do not use when:**

- You already have a compliant `parquet`/`csv` extract — go to `det-stage-artifact`.
- You have no audited reducer installation — author CSV, JSON or Parquet evidence tables and go to `det-prepare-bundle`.
- Your input is **legacy pre-2020 Fluent** `.cas`/`.dat` (non-CFF) — no open spec, unsupported. Modern Fluent CFF `.cas.h5`/`.dat.h5` is supported. Raw 10 GB–50 TB volume dumps are out of scope by design — extract a surface/probe first.
- Your OpenFOAM case is **parallel-decomposed** (`processor0/`, `processor1/`, …) — run `reconstructPar` first, or point at the reconstructed case; the tool rejects decomposed cases rather than read a partial domain.

## Prerequisites

- An audited design-partner installation of `deterministic-extract`, on `PATH` or pointed at by `DETERMINISTIC_EXTRACT_BIN`. The published `det` CLI orchestrates the same reducer through `det extract`, resolving it from `DETERMINISTIC_EXTRACT_BIN`, then `PATH`, then an opt-in pinned `uvx` fetch (`--allow-uvx`) that cannot run until public distribution. See https://deterministic.sh/docs/cli/extract/
- The commands below write `deterministic-extract` for the PATH install. If your installation is configured only through `DETERMINISTIC_EXTRACT_BIN` (the executable path), run `"${DETERMINISTIC_EXTRACT_BIN:-deterministic-extract}"` in its place, quoted so a path with spaces still works, as Step 4 shows.
- No network access; this skill is local-only.

## Steps

1. **Confirm the input format.** The tool detects by magic bytes (files) and structure (an OpenFOAM case is a directory with `system/` + `constant/`, or a `.foam` stub). Unsupported input is rejected with an actionable message. For OpenFOAM, pass the **case directory** (or its `.foam` file) as the input.

2. **Choose an extraction mode:**
   - **Surface:** `--surface [NAME]` — outer boundary surface, or a named MultiBlock block.
   - **Probe line:** `--probe x1,y1,z1 x2,y2,z2 [--resolution N]` — sample fields along a line.

3. **Select fields** with `--fields p,U,...` (omit to keep all). Vector fields (e.g. `U`) are exploded to `U_x,U_y,U_z` columns; point coordinates become `x,y,z`.

4. **Run the tool:**

   ```bash
   "${DETERMINISTIC_EXTRACT_BIN:-deterministic-extract}" case.vtu --surface body --fields p,U --out body.parquet
   ```

   It writes `body.parquet` and `body.parquet.schema.json` alongside.

5. **Confirm units + role in the schema sidecar.** The tool extracts numbers, not meaning — `units` and `role` are emitted as `null`. Fill them in (e.g. `U_x` role `velocity`, units `m/s`) before validating. CFD formats do not reliably store units; this is a required human/agent confirmation step.

6. **Hand off:**
   - Stage the parquet with `det-stage-artifact` (it exceeds inline limits) → get an `r2-artifact://` URI.
   - Build the bundle with `det-prepare-bundle`, using the confirmed schema for the evidence item's `schema` and the staged URI for `uri`.

## Output interpretation

- `body.parquet` — rows are **points** (cell data is sampled to points); columns are `x,y,z` + exploded fields. IEEE 754 values (NaN/±Inf) are preserved exactly.
- `body.parquet.schema.json` — per-column `name`, `dtype`, and `units`/`role` placeholders to confirm.

## Gotchas

- **PyVista loads the whole file into RAM** (failures around ~7 GB) on the VTK/VTU and OpenFOAM paths. For very large inputs, extract a reduced surface/probe upstream; EnSight Gold, CGNS and Fluent CFF read selectively.
- **`--surface` vs `--probe`** are mutually exclusive.
- Requested `--fields` not present in the extract produce a clear error listing what is available.

## Supported domains

<!-- domains-inventory:start -->

Supported `domain` values (canonical kebab-case ids). The snake_case alias is accepted wherever a domain is written or read (`validate`, the `list-checks` / `describe-domain` catalog tools, the `GET /api/v1/reports?domain=` filter and both feedback-candidate filters) and canonicalized before it is stored or compared, so stored reports and feedback aggregates carry the canonical id and an alias filter returns the same rows as the canonical one. Generated from the engine check inventory by `npm run generate:agent-surfaces`; do not edit between the markers.

| Domain                  | Alias                   | Checks | Reference                                         |
| ----------------------- | ----------------------- | ------ | ------------------------------------------------- |
| `fluid-simulation`      | `fluid_simulation`      | 21     | https://deterministic.sh/docs/domains/cfd/        |
| `structural-simulation` | `structural_simulation` | 22     | https://deterministic.sh/docs/domains/structural/ |
| `thermal-simulation`    | `thermal_simulation`    | 16     | https://deterministic.sh/docs/domains/thermal/    |

<!-- domains-inventory:end -->

## Examples

### Example 1 — boundary surface of a VTU, pressure + velocity

```bash
deterministic-extract case.vtu --surface body --fields p,U --out body.parquet
# -> body.parquet (rows = surface points; columns x,y,z,p,U_x,U_y,U_z)
# -> body.parquet.schema.json (confirm units: p=Pa, U_*=m/s; role: U_*=velocity)
```

Then: `det-stage-artifact body.parquet` → `r2-artifact://…`, and `det-prepare-bundle` using the confirmed schema.

### Example 2 — centerline probe line

```bash
deterministic-extract case.vtu --probe 0,0.5,0 1,0.5,0 --resolution 200 --out centerline.parquet
# -> 201 sampled points along the line, all fields interpolated
```

### Example 3 — OpenFOAM case, named boundary patch

```bash
deterministic-extract ./myCase --surface movingWall --fields p,U --out wall.parquet
# pass the OpenFOAM case directory (latest time step is used)
# decomposed case (processor0/, …)? run `reconstructPar` first
```

### Example 4 — EnSight Gold case, one part

```bash
deterministic-extract sim.case --surface fluid --fields p,U --out part.parquet
# pass the .case file (or its directory). Omit the part name for all parts.
# reads via mmap (large-file friendly); --probe is not supported for EnSight yet.
```

### Example 5 — CGNS, one zone

```bash
deterministic-extract wing.cgns --surface Zone --fields Pressure,VelocityX --out zone.parquet
# pass the .cgns file. Omit the zone name for all zones.
# node-located fields only; vector components stay separate (VelocityX/Y/Z); --probe not supported.
# NOTE: a CGNS file is domain-structured; it is not a flat evidence table.
```

### Example 6 — Fluent CFF, one boundary zone

```bash
deterministic-extract case.dat.h5 --surface wall --fields Pressure,VelocityX --out wall.parquet
# pass the .dat.h5 (the matching .cas.h5 must be alongside). Omit the zone name for all zones.
# face-centered: one point per face (centroid); SVAR keys mapped (SV_P->Pressure, SV_U->VelocityX, …).
# reads offline via PyFluent's filereader — no Fluent install. Legacy pre-2020 non-CFF .cas/.dat unsupported.
```

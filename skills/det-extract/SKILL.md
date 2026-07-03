---
name: det-extract
description: >-
  Convert native CFD solver output into a Deterministic-compliant Parquet extract
  (plus an evidence schema sidecar) entirely on the local machine. Use when you
  have simulation output and need an analysis-ready tabular artifact to reference
  in a validation bundle — before det-stage-artifact and det-prepare-bundle.
  Reads VTK (.vtu/.vtp/.vtk/.pvd), OpenFOAM (case directory or .foam stub),
  EnSight Gold (.case), CGNS (.cgns), and Fluent CFF (.cas.h5/.dat.h5). Do NOT
  use when you already have a compliant
  parquet/CSV extract — go straight to det-stage-artifact. Runs client-side and
  produces no network traffic; raw simulation data never leaves the machine.
---

# det-extract

Turn native CFD output into a Deterministic-ready **Parquet** extract + an **evidence schema** sidecar, locally. Runs the `deterministic-extract` tool (`uvx deterministic-extract …`); only the small extract leaves the machine — raw simulation data does not.

## When to use

**Use when:**
- You have CFD output (VTK `.vtu`/`.vtp`/`.vtk`/`.pvd`, an **OpenFOAM** case directory / `.foam` stub, an **EnSight Gold** `.case`, a **CGNS** `.cgns`, or a **Fluent CFF** `.cas.h5`/`.dat.h5`) and need a tabular artifact to validate.
- You want a boundary-**surface** extract or a **probe/sample-line** through the field (probe is VTK/OpenFOAM only).
- The customer's data is large or proprietary and must not be uploaded raw. (EnSight Gold, CGNS, and Fluent CFF read selectively — only the requested nodes/variables/zones are paged in.)

**Do not use when:**
- You already have a compliant `parquet`/`csv` extract — go to `det-stage-artifact`.
- Your input is **legacy pre-2020 Fluent** `.cas`/`.dat` (non-HDF5) — no open spec, unsupported. Modern Fluent CFF `.cas.h5`/`.dat.h5` is supported. Raw 10 GB–50 TB volume dumps are out of scope by design — extract a surface/probe first.
- Your OpenFOAM case is **parallel-decomposed** (`processor0/`, `processor1/`, …) — run `reconstructPar` first, or point at the reconstructed case; the tool rejects decomposed cases rather than read a partial domain.

## Prerequisites

- The `deterministic-extract` tool: `uvx deterministic-extract --help` (or `pip install 'deterministic-extract[vtk]'`).
- No network access; this skill is local-only.

## Steps

1. **Confirm the input format.** The tool detects by magic bytes (files) and structure (an OpenFOAM case is a directory with `system/` + `constant/`, or a `.foam` stub). Unsupported input is rejected with an actionable message pointing at the relevant later-phase issue. For OpenFOAM, pass the **case directory** (or its `.foam` file) as the input.

2. **Choose an extraction mode:**
   - **Surface:** `--surface [NAME]` — outer boundary surface, or a named MultiBlock block.
   - **Probe line:** `--probe x1,y1,z1 x2,y2,z2 [--resolution N]` — sample fields along a line.

3. **Select fields** with `--fields p,U,...` (omit to keep all). Vector fields (e.g. `U`) are exploded to `U_x,U_y,U_z` columns; point coordinates become `x,y,z`.

4. **Run the tool:**
   ```bash
   uvx deterministic-extract case.vtu --surface body --fields p,U --out body.parquet
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

- **PyVista loads the whole file into RAM** (failures around ~7 GB). For very large inputs, extract a reduced surface/probe upstream, or wait for the EnSight (#671, memory-mapped) / CGNS (#672, chunked) phases.
- **`--surface` vs `--probe`** are mutually exclusive.
- Requested `--fields` not present in the extract produce a clear error listing what is available.

## Examples

### Example 1 — boundary surface of a VTU, pressure + velocity

```bash
uvx deterministic-extract case.vtu --surface body --fields p,U --out body.parquet
# -> body.parquet (rows = surface points; columns x,y,z,p,U_x,U_y,U_z)
# -> body.parquet.schema.json (confirm units: p=Pa, U_*=m/s; role: U_*=velocity)
```
Then: `det-stage-artifact body.parquet` → `r2-artifact://…`, and `det-prepare-bundle` using the confirmed schema.

### Example 2 — centerline probe line

```bash
uvx deterministic-extract case.vtu --probe 0,0.5,0 1,0.5,0 --resolution 200 --out centerline.parquet
# -> 201 sampled points along the line, all fields interpolated
```

### Example 3 — OpenFOAM case, named boundary patch

```bash
uvx deterministic-extract ./myCase --surface movingWall --fields p,U --out wall.parquet
# pass the OpenFOAM case directory (latest time step is used)
# decomposed case (processor0/, …)? run `reconstructPar` first
```

### Example 4 — EnSight Gold case, one part

```bash
uvx deterministic-extract sim.case --surface fluid --fields p,U --out part.parquet
# pass the .case file (or its directory). Omit the part name for all parts.
# reads via mmap (large-file friendly); --probe is not supported for EnSight yet.
```

### Example 5 — CGNS, one zone

```bash
uvx deterministic-extract wing.cgns --surface Zone --fields Pressure,VelocityX --out zone.parquet
# pass the .cgns file. Omit the zone name for all zones.
# node-located fields only; vector components stay separate (VelocityX/Y/Z); --probe not supported.
# NOTE: a CGNS file is domain-structured HDF5 — this is NOT the same as sending a flat tabular HDF5.
```

### Example 6 — Fluent CFF, one boundary zone

```bash
uvx deterministic-extract case.dat.h5 --surface wall --fields Pressure,VelocityX --out wall.parquet
# pass the .dat.h5 (the matching .cas.h5 must be alongside). Omit the zone name for all zones.
# face-centered: one point per face (centroid); SVAR keys mapped (SV_P->Pressure, SV_U->VelocityX, …).
# reads offline via PyFluent's filereader — no Fluent install. Legacy pre-2020 .cas/.dat unsupported.
```

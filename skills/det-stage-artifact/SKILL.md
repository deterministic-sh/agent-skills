---
name: det-stage-artifact
description: >-
  Upload a large evidence file to Deterministic staging so it can be referenced
  in a validation request. Use when an evidence file is too large to inline in
  the validation request body (>2 MiB, or when the combined bundle would exceed
  2 MiB). Use retain=true for any artifact that will be referenced in a
  subsequent POST /api/v1/validate call. Do NOT use for small evidence that fits
  inline, and do NOT stage secrets or credentials files.
---

# det-stage-artifact

Upload an evidence file to the Deterministic staging endpoint (`POST /api/artifacts/staging`) and get back an artifact URI to reference in your validation bundle.

## When to use

**Use when:**
- An individual evidence file is larger than 2 MiB, or the combined bundle would exceed the 2 MiB body cap.
- You need to reference the file from an `evidence` item using `uri: "r2-artifact://<requestId>/<artifactId>"`.
- The file is in a supported format: `csv`, `json`, `parquet`, or `hdf5` (HDF5 is gated in production — check with the server if unsupported format errors appear).

**Do not use when:**
- The evidence value fits inline (under 2 MiB total bundle). Just embed it in the `evidence[].value` field.
- The file is not simulation evidence (no staging of source code, configs, or any file on the denylist below).

## Prerequisites

- An API key: `det_live_<key-id>_<secret>` set in `DETERMINISTIC_API_KEY` or passed as `Authorization: Bearer <key>`.
- The `Content-Length` of the file must be known before upload. Chunked / unknown-length bodies are rejected with `411 length_required`.
- Per-file cap: **100 MiB**. Per-request body cap: **101 MiB**.

## Transport selection

This skill uses HTTP only (`POST /api/artifacts/staging`). There is no MCP or CLI surface for artifact staging; the HTTP endpoint is the single transport.

## Steps

1. **Check the file.** Verify the file is not on the denylist (see below). Check its byte size. If the file is larger than 100 MiB, it cannot be staged — ask the caller to provide a smaller excerpt or split the file.

2. **Confirm for large uploads.** If the file is larger than **10 MiB**, confirm with the caller before proceeding. State the file name and byte size.

3. **Choose IDs.**
   - `requestId`: a caller-chosen identifier for this staging batch. Use a stable, descriptive value (e.g. `req_pipe_run_001`). Characters: `[A-Za-z0-9._-]`, 1–128 chars.
   - `artifactId`: a caller-chosen identifier for this specific file, used in the `r2-artifact://` URI. Characters: `[A-Za-z0-9._-]`, 1–128 chars. Make it descriptive (e.g. `art_axial_velocity`).

4. **Set `retain`.** Use `retain=true` for any artifact that will be referenced by a subsequent validation call. Non-retained artifacts are deleted at the end of the staging request and cannot be resolved later. When in doubt, use `retain=true`.

5. **Upload.**

   ```http
   POST /api/artifacts/staging HTTP/1.1
   Authorization: Bearer det_live_<key-id>_<secret>
   Content-Type: multipart/form-data; boundary=<boundary>
   Content-Length: <total-body-byte-length>

   --<boundary>
   Content-Disposition: form-data; name="requestId"

   req_pipe_run_001
   --<boundary>
   Content-Disposition: form-data; name="artifactId"

   art_axial_velocity
   --<boundary>
   Content-Disposition: form-data; name="retain"

   true
   --<boundary>
   Content-Disposition: form-data; name="file"; filename="axial_velocity.csv"
   Content-Type: text/csv

   <file bytes>
   --<boundary>--
   ```

6. **Parse the response.** On `200 OK`:

   ```json
   {
     "artifactId": "art_axial_velocity",
     "byteLength": 8388608,
     "requestId": "req_pipe_run_001",
     "retained": true
   }
   ```

   Construct the URI: `r2-artifact://<requestId>/<artifactId>`.

7. **Reference in the bundle.** Replace the `value` field in the evidence item with `uri`:

   ```json
   {
     "id": "axial_velocity_profile",
     "kind": "series",
     "role": "primary_result",
     "format": "csv",
     "schema": { "r": "number", "u_axial": "number" },
     "uri": "r2-artifact://req_pipe_run_001/art_axial_velocity"
   }
   ```

## File denylist

Never stage any of the following:

- `.env`, `*.env.*`
- `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx`
- `credentials.json`, `secrets.json`, `*.secret`
- SSH private keys (`id_rsa`, `id_ed25519`, etc.)
- Any file whose name contains `secret`, `password`, `token`, or `credential`

Reject the request and tell the caller before making any network call.

## Error handling

| Status | Code | Action |
|---|---|---|
| `400` | malformed multipart or invalid key segment | Fix `requestId` / `artifactId` characters or the multipart construction. Check for non-ASCII chars, spaces, or leading/trailing dots. |
| `401` | plain text `unauthorized` | API key is missing, malformed, or expired. Set `DETERMINISTIC_API_KEY` or re-issue the key. |
| `411` | `length_required` | `Content-Length` header is missing or not a valid integer. The full file size must be known before the request starts. |
| `413` (`reason: 'request_body'`) | `payload_too_large` | Total body exceeds 101 MiB. Split into multiple staging calls. |
| `413` (`reason: 'artifact'`) | `payload_too_large` | File exceeds 100 MiB per-file cap. Reduce or split. |
| `429` (`rate_limited`) | — | Per-actor hourly attempt window exceeded. Wait and retry. |
| `429` (`quota_exceeded`) | `reason: 'object_count'` or `'byte_total'` | Daily retention quota reached. Contact Deterministic support or reduce retained artifacts. |
| `500` | — | Infrastructure failure. Log the error, wait, and retry once. If it persists, report the issue. |

**Artifact miss at validation time** (`422 artifact_resolution_failed`): if the validate call says the artifact was not found, confirm that:
- `retain=true` was used during staging.
- The `requestId` and `artifactId` in the URI exactly match what was returned by this endpoint.
- The same API key (same `userId`) is used for both staging and validation.

## Examples

### Example 1 — Stage a CSV file retained for validation

```bash
curl -X POST https://deterministic.sh/api/artifacts/staging \
  -H "Authorization: Bearer det_live_k1_abc123" \
  -H "Content-Length: $(wc -c < axial_velocity.csv)" \
  -F "requestId=req_pipe_001" \
  -F "artifactId=art_axial_vel" \
  -F "retain=true" \
  -F "file=@axial_velocity.csv"
```

Response:

```json
{
  "artifactId": "art_axial_vel",
  "byteLength": 3145728,
  "requestId": "req_pipe_001",
  "retained": true
}
```

Use in a bundle evidence item:

```json
{ "uri": "r2-artifact://req_pipe_001/art_axial_vel" }
```

### Example 2 — Stage a Parquet file, >10 MiB, confirmation required

The file `pressure_field.parquet` is 18.3 MiB. Before staging, tell the caller:

> `pressure_field.parquet` is 18.3 MiB. Proceed with staging this file to Deterministic? (retain=true)

After confirmation:

```bash
curl -X POST https://deterministic.sh/api/artifacts/staging \
  -H "Authorization: Bearer det_live_k1_abc123" \
  -H "Content-Length: 19189760" \
  -F "requestId=req_cavity_run_002" \
  -F "artifactId=art_pressure_field" \
  -F "retain=true" \
  -F "file=@pressure_field.parquet"
```

Response:

```json
{
  "artifactId": "art_pressure_field",
  "byteLength": 19189760,
  "requestId": "req_cavity_run_002",
  "retained": true
}
```

Evidence item:

```json
{
  "id": "pressure_field",
  "kind": "table",
  "role": "primary_result",
  "format": "parquet",
  "schema": {
    "x": "number",
    "y": "number",
    "p": { "type": "number", "role": "pressure" }
  },
  "uri": "r2-artifact://req_cavity_run_002/art_pressure_field"
}
```

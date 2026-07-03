#!/usr/bin/env node
// Tarball-allowlist gate for `npm pack` output — VENDORED standalone copy.
//
// AUTHORED IN THE MONOREPO at
// packages/agent-skills/mirror/scripts/assert-tarball-allowlist.mjs. Edit it
// there ONLY — this file is DELIVERED to the public
// deterministic-sh/agent-skills repo as scripts/assert-tarball-allowlist.mjs
// by the mirror workflow (scripts/workflows/assemble-skills-mirror.mjs). The
// public repo has no monorepo scripts directory to import from, so this is a
// standalone, dependency-free copy rather than a re-export of
// scripts/workflows/assert-agent-skills-tarball-allowlist.mjs (the
// monorepo's own build-time gate, which this vendors and stays behaviorally
// in sync with).
//
// Reads `npm pack --dry-run --json` output from a JSON file path (passed as
// the first positional arg) and asserts every path inside the produced
// tarball is within:
//
//   - package/skills/**
//   - package/README.md
//   - package/LICENSE
//   - package/package.json
//
// Any path outside the allowlist -> exit 1 with the offending list to
// stderr. publish-agent-skills.yml calls this against BOTH the dry-run pack
// JSON and the real tarball's file list, before the npm-publish environment
// approval gate fires.

import { readFileSync } from 'node:fs'

// Allowlist accepts both path shapes: `npm pack --dry-run --json` reports
// paths WITHOUT the `package/` prefix (relative to the package root), while
// `tar -tzf <real-tarball>` reports paths WITH the `package/` prefix (the
// archive root) — including the bare `package/skills/` directory entry.
const ALLOWLIST = [
  /^skills\/.+$/,
  /^skills\/$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^package\.json$/,
]

function isAllowed(filePath) {
  const normalized = filePath.startsWith('package/') ? filePath.slice('package/'.length) : filePath
  // Tar may list bare directory entries (e.g. `package/skills/`); an empty
  // remainder after stripping `package/` is the archive root itself — allow it.
  if (normalized === '') return true
  return ALLOWLIST.some((re) => re.test(normalized))
}

function main() {
  const arg = process.argv[2]
  if (!arg) {
    process.stderr.write('usage: assert-tarball-allowlist.mjs <pack.json>\n')
    process.exit(2)
  }

  const raw = readFileSync(arg, 'utf8')
  const parsed = JSON.parse(raw)
  // npm pack --json emits an array; first element is the package descriptor
  // with `files: [{ path: 'package/skills/foo/SKILL.md', ...}]`.
  const desc = Array.isArray(parsed) ? parsed[0] : parsed
  if (!desc || !Array.isArray(desc.files)) {
    process.stderr.write(`assert-tarball-allowlist: unrecognized npm-pack JSON shape at ${arg}\n`)
    process.exit(2)
  }

  const offenders = []
  for (const f of desc.files) {
    const p = typeof f === 'string' ? f : f.path
    if (typeof p !== 'string') continue
    if (!isAllowed(p)) offenders.push(p)
  }

  if (offenders.length === 0) {
    process.stdout.write(`assert-tarball-allowlist: ok (${desc.files.length} file(s) inside allowlist)\n`)
    process.exit(0)
  }

  process.stderr.write('assert-tarball-allowlist: FAIL — tarball contains paths outside the allowlist.\n')
  for (const o of offenders) process.stderr.write(`  ${o}\n`)
  process.exit(1)
}

main()

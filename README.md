# Deterministic agent skills

Agent skills for [Deterministic](https://deterministic.sh) — runtime verification
for AI-generated science and engineering. The `deterministic` meta-skill routes to
thirteen `det-*` sub-skills covering the full validation lifecycle: extract and
prepare evidence, run validations over the HTTP API or MCP, read and interpret
receipts, and submit reviewer feedback.

Each skill is a plain-Markdown `SKILL.md` following the open
[agent-skills standard](https://agentskills.io), loadable by Claude Code, Codex,
Gemini CLI, Copilot, and any framework with a skill API (Claude Agent SDK,
Cloudflare Agents SDK, Vercel AI SDK, LangChain Deep Agents).

## Install

Hosted installer (detects your local coding agents and copies the skills in):

```bash
npx skills add deterministic-sh/agent-skills
```

Copy-paste (Claude Code):

```bash
cp -r skills/deterministic skills/det-* .claude/skills/
```

Copy-paste (Codex, Gemini CLI, Copilot, and other AGENTS.md-aware tools):

```bash
cp -r skills/deterministic skills/det-* .agents/skills/
```

Full install guide, platform integration options, and prerequisites:
[docs.deterministic.dev/agent-skills/install](https://docs.deterministic.dev/agent-skills/install/).

The npm package `@deterministic-sh/agent-skills` carries the same files; it is
not published yet.

## About this repository

This is a **read-only distribution mirror**, updated automatically from a private
canonical source (see `.github/mirror-manifest.json` for the source commit of the
current snapshot). Issues are welcome here; pull requests cannot be merged into a
mirror — changes land upstream and flow out with the next sync.

## License

[MIT](./LICENSE).

---
name: det-auth
description: >-
  Configure and verify Deterministic API credentials. Use when an agent needs
  to set up authentication for the first time, clear stored credentials, verify
  which credentials are active, or understand how the CLI resolves API keys and
  hosts. Trigger phrases: "authenticate", "set up API key", "log in to
  deterministic", "det auth login", "det auth whoami", "clear credentials",
  "which API key is being used", "what host am I connected to". Do NOT use for
  diagnosing failed API calls — that is det-troubleshoot. This skill covers the
  CLI transport only; HTTP and MCP callers configure auth by setting the
  DETERMINISTIC_API_KEY environment variable and passing the Authorization
  header directly.
---

# det-auth

Configure, verify, and clear Deterministic API credentials using the `det auth` CLI subcommands.

## When to use

**Use when:**
- Setting up credentials for the first time.
- Checking which host and API key are currently active.
- Removing stored credentials before switching accounts or hosts.
- Scripting CI authentication via environment variable.

**Do not use when:**
- Debugging a 401 error from an existing integration — use det-troubleshoot.
- Calling the HTTP or MCP API directly — set `DETERMINISTIC_API_KEY` in the environment and pass `Authorization: Bearer $DETERMINISTIC_API_KEY` in requests.

## Transport

CLI only. HTTP and MCP callers do not use these commands; they read credentials from the environment and construct `Authorization` headers themselves.

## Prerequisites

- `det` CLI installed and on `$PATH`. Verify with `det --version`.
- An API key from the Deterministic dashboard (`https://deterministic.app`).

## Credential resolution order

When any `det` command runs, the CLI resolves the API key and host in this priority order:

| Priority | API key source | Host source |
|---|---|---|
| 1 (highest) | `$DETERMINISTIC_API_KEY` env var | `--host` flag |
| 2 | `~/.config/deterministic/credentials.json` | `$DETERMINISTIC_HOST` env var |
| 3 | — | `credentials.json` `host` field |
| 4 (lowest) | — | `https://deterministic.app` (built-in default) |

`XDG_CONFIG_HOME` overrides the `~/.config` base directory when set.

## Host validation rules

The CLI enforces these scheme rules before sending any bearer-carrying request:

- `https://` — always accepted.
- `http://` — accepted only for loopback destinations: `localhost`, `127.0.0.1`, `[::1]`, and any `*.localhost` subdomain (covers Portless local dev URLs).
- All other schemes, and any URL containing `user:password` userinfo, are rejected with exit code 2.

Never embed an API key in a host URL or pass it as a command-line argument.

## Commands

### `det auth login [--host <url>]`

Prompt for an API key and write it to `~/.config/deterministic/credentials.json` with mode `0600` (file) and `0700` (parent directory).

On a TTY, the host prompt defaults to `https://deterministic.app`; press Enter to accept the default. The API key prompt is no-echo. In pipe mode (non-TTY), the host is resolved from `--host` or `$DETERMINISTIC_HOST` without prompting; stdin carries the API key as a single line.

```bash
det auth login
# Host [https://deterministic.app]: <Enter>
# API key: (no echo)
# Saved credentials to /home/user/.config/deterministic/credentials.json

det auth login --host https://staging.deterministic.app
# API key: (no echo)
```

Pipe mode (CI):

```bash
printf '%s' "$DETERMINISTIC_API_KEY" | det auth login --host https://deterministic.app
```

Exit codes: `0` on success, `2` on invalid host or missing key.

### `det auth logout`

Remove the credentials file at `~/.config/deterministic/credentials.json`. Does not affect environment variables.

```bash
det auth logout
```

Exit code: `0` if the file was removed or did not exist, `2` on a file-system error.

### `det auth whoami`

Print the active host, a redacted version of the API key, and which source provided it.

```bash
det auth whoami
# host: https://deterministic.app
# api key: det_live_abc123_<redacted>
# source: env
```

The key display:
- If the key matches `det_(live|test)_<key-id>_<secret>`, the secret tail is elided and the output shows `det_live_<key-id>_<redacted>`.
- Otherwise the entire key is replaced with `<redacted>`.

`source` is `env` when `$DETERMINISTIC_API_KEY` is set; `file` when credentials come from `credentials.json`.

Exit codes: `0` on success, `2` when no credentials are found.

## Environment variables for headless / CI use

```bash
# Set the API key — preferred over storing in a file for CI environments.
export DETERMINISTIC_API_KEY=det_live_<key-id>_<secret>

# Override the host without using --host on every command.
export DETERMINISTIC_HOST=https://deterministic.app
```

Never put the API key value in a URL, a shell history line, a log file, or a script argument. Use environment variables or the credentials file.

## Examples

### Example 1 — Interactive first-time setup

```bash
det auth login
# Host [https://deterministic.app]: <Enter to accept>
# API key: (type key, no echo)
# Saved credentials to /home/user/.config/deterministic/credentials.json

det auth whoami
# host: https://deterministic.app
# api key: det_live_k7m4n9_<redacted>
# source: file
```

### Example 2 — CI environment variable, verify active credentials

```bash
export DETERMINISTIC_API_KEY=det_live_k7m4n9_<secret>

det auth whoami
# host: https://deterministic.app
# api key: det_live_k7m4n9_<redacted>
# source: env
```

The `env` source means the environment variable takes precedence over any stored credentials file.

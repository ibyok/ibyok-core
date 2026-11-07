---
name: ibyok-troubleshoot
description: Diagnose ibyok CLI and IBYOK API problems, including login and token errors, missing or stale key mappings, quota exceeded (429), mock vs live mode confusion, apps that still see the wrong key, and running ibyok in CI. Use when an `ibyok` command fails or an app run with `ibyok run` doesn't get the keys it expects.
---

# Troubleshoot IBYOK

Always start with:
```bash
npx -y ibyok status --json
```
It checks auth, finds `.ibyok.json`, validates every mapping against the account,
and reports quota. It exits 1 and lists `problems` when something is wrong. It
never fetches key values or counts against quota.

The rules from `ibyok-setup` still apply: never print env values from an
`ibyok run` child, and never handle the access token yourself.

## Errors

| Message contains | Cause | Fix |
|---|---|---|
| `Not logged in` | No saved token and no `IBYOK_ACCESS_TOKEN` | User runs `npx ibyok login` in their own terminal; CI sets the `IBYOK_ACCESS_TOKEN` secret |
| `invalid or expired` | Token revoked or past its expiry (Premium tokens always expire) | User creates a new token at https://www.ibyok.com/dashboard/tokens and runs `npx ibyok login` again |
| `keys:read` / `scope` | Token was created without `keys:read` | New token with `keys:read` (and `usage:read` for quota display) |
| `No .ibyok.json found` | Not set up, or running outside the project tree | `npx -y ibyok init`; the file is found in the current or any parent directory |
| `cannot see` / `MISSING` / `No key with ID or name` | Mapping points to a deleted key, or a key from another account | `npx -y ibyok keys`, then `npx -y ibyok add NAME <key>` to remap |
| `quota` / 429 | Monthly live-call limit reached | Mock calls are unlimited, so use `--env development` for local and test runs. Use `--only` so a command fetches only what it needs. Or upgrade at https://www.ibyok.com/dashboard/billing |
| `Could not reach the IBYOK API` | Network, proxy, or a wrong `IBYOK_API` | Check connectivity; unset `IBYOK_API` unless self-hosting |
| `Command not found` (exit 127) | The command after `--` isn't on PATH | Use the full command, e.g. `ibyok run -- npx next dev` |

## "The app gets a fake key" / provider returns 401

The environment is in **mock mode**. In development and staging, IBYOK returns
fake keys by default. Check with:
```bash
npx -y ibyok keys --env development
```
The MODE column shows `mock` or `live`. To get real keys, either run with
`--env production`, or have the user switch that environment (or just that key)
to live in the dashboard. Remind the user that live calls count against quota.

## "The app still uses the old key"

Something else sets the variable after `ibyok run` injects it:
- `dotenv` with `override: true`, or a framework that loads `.env` with override
  semantics. Remove the key from `.env`.
- The script runs the app without the `ibyok run --` prefix, or a process manager
  restarts it without the prefix.
- The variable name differs: the app reads `OPENAI_KEY` but the mapping is
  `OPENAI_API_KEY`. Compare the mapping names in `ibyok status` with what the code reads.

`ibyok run` prints `overrode existing NAME` when it replaces a variable that was
already set in the parent shell. That's expected when a stale value is exported
in the shell profile, and it means the IBYOK value wins.

## CI

```yaml
- run: npx -y ibyok run --env staging -- npm test
  env:
    IBYOK_ACCESS_TOKEN: ${{ secrets.IBYOK_ACCESS_TOKEN }}
```
The child process does not receive `IBYOK_ACCESS_TOKEN`. `ibyok run` strips it, so
tests can't leak it.

## Still stuck

Collect `npx -y ibyok status --json` output (it contains no secrets) and the exact
error line, and point the user to https://github.com/ibyok/ibyok-core/issues.

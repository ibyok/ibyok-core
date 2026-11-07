# ibyok-core

The official CLI and AI agent skills for [IBYOK](https://www.ibyok.com) (Bring Your Own Keys).

Keep LLM API keys out of your code, your `.env` files and your CI config. Store them once
in IBYOK, then run any command with the keys injected as environment variables:

```bash
npx ibyok run -- npm run dev
```

Your app keeps reading `process.env.OPENAI_API_KEY` exactly as before. No SDK and no
code changes. It works in any terminal, CI system or editor, and with any AI coding
agent: Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, Windsurf and more.

- **Never on disk.** Key values exist only in the environment of the process you run.
  The project file `.ibyok.json` holds only key IDs, so commit it.
- **Mock mode for free.** In development and staging, IBYOK can hand out realistic fake
  keys, so local runs and tests don't spend provider credits or quota.
- **Agent-safe.** The included skills let any AI agent set up and migrate a project
  without a key value ever entering its context.

## Quick start

1. Create an access token with the `keys:read` scope at
   [ibyok.com/dashboard/tokens](https://www.ibyok.com/dashboard/tokens). Add `usage:read`
   to see your quota in `ibyok status`.
2. Log in. The prompt hides your input, and the token is saved to
   `~/.config/ibyok/credentials.json` with `0600` permissions:
   ```bash
   npx ibyok login
   ```
3. In your project, map env vars to your stored keys:
   ```bash
   npx ibyok init          # interactive; or --all to accept suggested names
   ```
4. Run anything with the keys injected:
   ```bash
   npx ibyok run -- npm run dev
   ```

To skip `npx`, add it to the project and prefix your scripts:

```bash
npm install --save-dev ibyok
```
```json
"scripts": {
  "dev": "ibyok run -- next dev",
  "test": "ibyok run -- vitest"
}
```

It isn't limited to Node projects. `ibyok run -- uv run app.py`, `ibyok run -- go run .`
and `ibyok run -- docker compose up` all work the same way.

## AI agent skills

The [`skills/`](skills) folder holds three skills in the open
[Agent Skills](https://agentskills.io) (`SKILL.md`) format:

| Skill | Use it to |
|---|---|
| [`ibyok-setup`](skills/ibyok-setup/SKILL.md) | Connect a project: log in, map keys, wire `ibyok run` into scripts |
| [`ibyok-migrate`](skills/ibyok-migrate/SKILL.md) | Move hardcoded and `.env` keys into IBYOK and clean them out of the repo |
| [`ibyok-troubleshoot`](skills/ibyok-troubleshoot/SKILL.md) | Diagnose login, mapping, quota and mock-mode problems |

They are written so the agent **never sees a key value or your access token**. It
verifies with `ibyok status` and `ibyok run --dry-run`, never by printing the
environment, and you run `ibyok login` yourself.

### Install in any agent

[`skills`](https://github.com/vercel-labs/skills) installs them into whichever agents
you use (Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Goose,
OpenCode and many more):

```bash
npx skills add ibyok/ibyok-core                       # pick agents interactively
npx skills add ibyok/ibyok-core -a codex -a cursor    # or name them
npx skills add ibyok/ibyok-core -g                    # for your user, not just this project
```

### Claude Code plugin

This repo is also a Claude Code plugin marketplace, which adds versioned updates:

```
/plugin marketplace add ibyok/ibyok-core
/plugin install ibyok@ibyok
```

### Manual install

Copy the folders in `skills/` into your agent's skills directory, for example
`.agents/skills/` (shared by several agents) or `.claude/skills/`. Check your
agent's docs for its path.

### Agents without skills support: `AGENTS.md`

If your agent reads `AGENTS.md` but doesn't support skills, append the IBYOK rules to
your project's `AGENTS.md`:

```bash
curl -fsSL https://raw.githubusercontent.com/ibyok/ibyok-core/main/templates/AGENTS.md >> AGENTS.md
```

[That snippet](templates/AGENTS.md) tells the agent to use `ibyok run`, to verify
without printing values, and to leave `ibyok login` to you. It's also worth adding
alongside the skills, so every agent in the repo follows the same rules.

## Commands

| Command | What it does |
|---|---|
| `ibyok login [--token-stdin]` | Save an access token (hidden prompt, or piped on stdin) |
| `ibyok logout` | Remove the saved token |
| `ibyok init [--env <env>] [--all] [--force]` | Create `.ibyok.json` and map keys to env vars |
| `ibyok keys [--env <env>] [--json]` | List your keys and their mock/live mode (never values) |
| `ibyok add <ENV_VAR> <key name or ID>` | Map an env var to a key |
| `ibyok remove <ENV_VAR>` | Remove a mapping |
| `ibyok status [--json]` | Check auth, config and every mapping; exits 1 on problems |
| `ibyok run [options] -- <command>` | Run a command with the mapped keys injected |

`run` options: `--env development|staging|production`, `--only A,B` (inject a subset),
`--dry-run` (validate and show what would be injected without fetching values), and
`--quiet`.

### `.ibyok.json`

```json
{
  "env": "development",
  "keys": {
    "ANTHROPIC_API_KEY": "01KMDK9XF2W0RQ7F27KKPPNJK7",
    "OPENAI_API_KEY": "01KMN5B0ZNSQWZMCFAENY3XMBY"
  }
}
```

The file is found in the current directory or any parent. The environment is chosen
in this order: `--env`, then `IBYOK_ENV`, then `"env"` in this file, then `development`.

### Environment variables

| Variable | Purpose |
|---|---|
| `IBYOK_ACCESS_TOKEN` | Access token; overrides the saved one. Use this in CI. |
| `IBYOK_ENV` | Default environment |
| `IBYOK_API` | API base URL (default `https://api.ibyok.com`) |
| `IBYOK_CONFIG_DIR` | Where `login` saves credentials |

## How `run` behaves

- It first checks every mapping with a metadata call that doesn't count against quota,
  so a stale mapping fails fast and costs nothing.
- It then fetches each value. Live values count against your quota; mock values don't.
  If **any** fetch fails, the command is not started, so it never runs with only some
  of its keys.
- The child gets the provider keys but **not** `IBYOK_ACCESS_TOKEN`.
- Signals and the exit code pass through, so `ibyok run` works under process managers,
  in `npm` scripts and in CI.
- The injection summary goes to stderr, so the command's stdout stays clean for pipes.

## CI

```yaml
- run: npx -y ibyok run --env staging -- npm test
  env:
    IBYOK_ACCESS_TOKEN: ${{ secrets.IBYOK_ACCESS_TOKEN }}
```

One secret replaces a secret per provider.

## Development

```bash
npm install
npm test        # builds, then runs unit tests and end-to-end tests against a fake API
```

Requires Node.js 18.17 or newer. There are no runtime dependencies. See
[AGENTS.md](AGENTS.md) for repo conventions (it's for humans too).

## License

[MIT](LICENSE). The IBYOK name and logo are trademarks of IBYOK and are not covered by
the license.

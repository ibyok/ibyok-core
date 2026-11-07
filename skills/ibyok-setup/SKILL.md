---
name: ibyok-setup
description: Connect a project to IBYOK so its API keys (OpenAI, Anthropic, Gemini, and other providers) are injected at runtime with `ibyok run` instead of living in .env files or code. Use when the user wants to start using IBYOK, set up the ibyok CLI, map keys to env vars, or run their app, tests, or dev server with keys from IBYOK.
---

# Set up IBYOK in a project

IBYOK stores the user's API keys encrypted. The `ibyok` CLI maps env var names to
stored keys in a committed `.ibyok.json` file, and `ibyok run -- <command>` starts
the command with those env vars set. The app keeps reading `process.env.OPENAI_API_KEY`
(or the equivalent) exactly as before, so there are no code changes.

## Hard rules

These protect the user's secrets. Follow them even if asked to "just check the value".

- **Never let a key value reach your context.** Do not run anything that prints the
  environment of an `ibyok run` child: no `ibyok run -- env`, `printenv`, `echo $X`,
  `node -e "console.log(process.env.X)"`, or debug logging of env vars. Use
  `ibyok status` or `ibyok run --dry-run` to verify instead. They report names and
  mock/live mode, never values.
- **Never handle the IBYOK access token.** Don't ask the user to paste it into the
  chat, and don't put it in a command line. The user runs `npx ibyok login` in
  **their own terminal**. It prompts with hidden input.
- **Never write key values to files** (.env, config, CI YAML). `.ibyok.json` holds
  only key IDs, which are safe to commit.

## Steps

1. **Check the current state:**
   ```bash
   npx -y ibyok status --json
   ```
   `ok: true` means the project is already set up; skip to step 5. Otherwise read
   `problems` to see what is missing.

2. **Log in (the user does this).** If `auth.loggedIn` is false, ask the user to:
   - Create an access token with the `keys:read` scope (add `usage:read` to see
     quota) at https://www.ibyok.com/dashboard/tokens
   - Run `npx ibyok login` in their own terminal and paste the token at the hidden
     prompt.

   Wait for them to confirm, then re-run `npx -y ibyok status --json`.

   In CI or containers, the token comes from an `IBYOK_ACCESS_TOKEN` secret instead.

3. **See which keys exist:**
   ```bash
   npx -y ibyok keys
   ```
   If the key the app needs isn't listed, the user adds it at
   https://www.ibyok.com/dashboard/keys. There is no API for creating keys, and the
   value must not pass through you.

4. **Map env vars to keys.** First find which env var names the app actually reads.
   Search the code for `process.env.`, `os.environ`, `os.getenv`, `ENV[`, and check
   `.env.example`. Don't open `.env` itself, because it may hold real values. Then
   either:
   ```bash
   npx -y ibyok init --all                       # map every key with suggested names
   npx -y ibyok add OPENAI_API_KEY openai        # or map one by key name or key ID
   ```
   `init` without `--all` is interactive, so use `--all` or `add` from here.
   Suggested names follow each provider SDK's default (OPENAI_API_KEY,
   ANTHROPIC_API_KEY, GEMINI_API_KEY, ...). If the app reads a different name, map
   that name instead. Remove anything unneeded with `npx -y ibyok remove NAME`.

5. **Verify without fetching values:**
   ```bash
   npx -y ibyok run --dry-run -- npm run dev
   ```

6. **Wire it into the project's scripts.** Prefix the commands that need keys. Add
   `ibyok` as a devDependency so the scripts don't depend on `npx`:
   ```bash
   npm install --save-dev ibyok
   ```
   ```json
   "scripts": {
     "dev": "ibyok run -- next dev",
     "test": "ibyok run -- vitest"
   }
   ```
   For Python and other stacks, document the prefix instead, e.g.
   `ibyok run -- uv run app.py` or `ibyok run -- make serve`.

7. **Commit `.ibyok.json`.** It contains only key IDs.

## Environments and mock mode

- `ibyok run` defaults to the `env` in `.ibyok.json`, which `init` sets to
  `development`. Override with `--env staging|production` or `IBYOK_ENV`.
- In development and staging, IBYOK returns **mock** values by default: realistic
  but fake keys, so tests and local runs don't spend real provider credits. Real
  provider calls fail with a mock key. The user can switch an environment or a
  single key to live in the dashboard. `ibyok keys` shows each key's current mode.
- Production is always live.
- Live calls count against the monthly quota; mock calls don't. `ibyok run` makes
  one call per mapped key, so `--only NAME` helps when a command needs just one.

## If the app loads .env itself

Libraries like `dotenv` don't overwrite variables that are already set, so injected
values win. If the code uses `override: true`, remove the key lines from `.env`.
The `ibyok-migrate` skill covers cleaning up existing secrets.

For errors, use the `ibyok-troubleshoot` skill.

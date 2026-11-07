
## API keys (IBYOK)

This project gets its API keys from [IBYOK](https://www.ibyok.com) at runtime. Key
values are never stored in the repo, in `.env` files or in CI config.

- **Run things through `ibyok run`.** Anything that needs keys (the dev server, tests,
  scripts) runs as `npx ibyok run -- <command>`. The env var to key mapping is in
  `.ibyok.json`, which holds key IDs only and is safe to read and commit.
- **Never print key values.** Don't run `ibyok run -- env`, `printenv`, `echo $VAR`, or
  any code that logs `process.env` / `os.environ` under `ibyok run`. To check setup,
  use `npx ibyok status` and `npx ibyok run --dry-run -- <command>`, which show names
  and mock/live mode only.
- **Don't read secret files.** Don't open or print `.env*` files (except
  `.env.example`). List variable names with
  `grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' <file>` if needed.
- **Never handle the IBYOK token.** If `ibyok status` says "Not logged in", ask the
  user to run `npx ibyok login` in their own terminal. Don't ask them to paste the
  token into the chat.
- **Adding a key:** the user stores it at https://www.ibyok.com/dashboard/keys, then
  map it with `npx ibyok add <ENV_VAR> <key name>`.
- **Mock mode:** in development and staging, keys may be fake (mock) by design. A
  provider 401 in dev usually means mock mode, not a bug. `npx ibyok keys` shows
  each key's mode.

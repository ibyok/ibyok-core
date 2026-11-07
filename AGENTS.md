# Working on ibyok-core

Instructions for AI agents and humans contributing to this repo. (For the snippet that
users add to *their* projects, see `templates/AGENTS.md`.)

## Layout

- `src/` is the `ibyok` CLI (TypeScript, CommonJS, Node 18.17+, **no runtime dependencies**).
  - `cli.ts` handles argument parsing and dispatch; `commands.ts` holds the command implementations.
  - `api.ts` is the External API client; `credentials.ts` handles token storage;
    `project-config.ts` handles `.ibyok.json`.
- `test/` has unit tests and end-to-end tests that run the built CLI against a fake API
  (`node:test`).
- `skills/` holds the agent skills in the open Agent Skills format (`<name>/SKILL.md`).
- `.claude-plugin/` holds the Claude Code plugin and marketplace manifests. Keep their
  `version` in sync with `package.json`.
- `templates/AGENTS.md` is the snippet users append to their own projects.

## Commands

```bash
npm install
npm test                         # build + all tests; must pass before committing
claude plugin validate .         # if the claude CLI is available and you changed skills or manifests
npx skills add . --list          # check the skills are discoverable by the cross-agent installer
```

## Rules

- **Key values never reach stdout, stderr, logs or disk.** Only `run` fetches values,
  and they go only into the child process environment. Any new feature must keep this
  true, and tests should assert it (see `cli.test.ts`, which checks output for `SECRET`).
- **The child process never receives `IBYOK_ACCESS_TOKEN`.**
- **Validate before spending quota.** Check mappings with the unmetered `GET /external/keys`
  before any metered `/value` call.
- **Don't add runtime dependencies** without a strong reason. `npx ibyok` should
  start fast and have a tiny supply-chain surface.
- **Skills must stay agent-neutral.** Use plain shell commands (`npx -y ibyok ...`), no
  tool-specific syntax, and keep the "never see a value or the token" rules in each skill.
- **Releases:** bump `version` in `package.json`, `.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json`, then tag `vX.Y.Z`. The release workflow publishes to npm.

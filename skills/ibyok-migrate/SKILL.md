---
name: ibyok-migrate
description: Move API keys that are hardcoded in source or stored in .env files into IBYOK, then remove them from the repo. Use when the user wants to get secrets or API keys out of their code or .env, secure leaked keys, stop committing keys, or migrate an existing project to IBYOK.
---

# Migrate a project's keys to IBYOK

The goal: no API key values in source, `.env` files, or CI config. The app gets them
at runtime from `ibyok run`. The user moves the values into IBYOK themselves. **You
never see, copy, or move a key value.**

## Hard rules

- **Do not read secret values.** Never `cat`, open, or print `.env`, `.env.local`,
  or similar files, and never print the lines that matched a secret pattern. Use
  the name-only and file-only commands below.
- **Never let `ibyok run` print env values.** See the rules in `ibyok-setup`.
- **Don't delete secrets before they are safely in IBYOK.** The user must confirm
  each key is stored and `ibyok status` must pass first.
- **Ask before rewriting git history.** Purging old commits is destructive and
  outward-facing. Rotating the key is the real fix anyway.

## 1. Inventory, by name and location only

Env files: list variable **names** only, never values:
```bash
for f in $(git ls-files -co --exclude-standard | grep -E '(^|/)\.env' ); do echo "== $f"; grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$f" | tr -d '='; done
```

Hardcoded keys: list **files and line numbers** only, never the matched text:
```bash
git grep -nIE -c 'sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gsk_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{30,}|xai-[A-Za-z0-9]{20,}|r8_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}' -- . ':!*.lock' ':!package-lock.json'
```
To work on a hit, view only the surrounding code structure. If a line contains a
literal key, describe it to the user ("line 12 of src/llm.ts assigns a literal
OpenAI key") instead of quoting it.

Which keys are actually used: search the code for `process.env.`, `os.environ`,
`os.getenv`, `ENV[`, and the provider SDK constructors.

Check whether env files were ever committed:
```bash
git log --all --oneline --name-only -- '*.env' '.env*' | head -50
```

Give the user a short table: env var name → where it's defined → used by → committed in history (yes/no).

## 2. User stores each key in IBYOK

Ask the user to add each key at https://www.ibyok.com/dashboard/keys, copying the
value from their `.env` or provider console themselves. If a key was ever committed
or shared, recommend creating a **new** key at the provider and storing that one.
The old one should be considered leaked.

Then run setup. Follow the `ibyok-setup` skill from step 1 (status → login → keys → map).

## 3. Replace hardcoded literals with env lookups

For each hardcoded key, change the code to read an env var. Use the name you mapped
in `.ibyok.json`:
```ts
// before: new OpenAI({ apiKey: "sk-..." })
new OpenAI({ apiKey: process.env.OPENAI_API_KEY })   // or just new OpenAI(): the SDK reads it by default
```
When you edit such a line, replace it entirely rather than echoing the old literal
back.

## 4. Verify before removing anything

```bash
npx -y ibyok status
npx -y ibyok run --dry-run -- <the app's start command>
```
Then have the user run the app or tests through `ibyok run` and confirm it works.

## 5. Remove the values from the repo

Only after step 4 passes and the user confirms:
- Delete the migrated `KEY=value` lines from `.env` files. Remove the whole line
  with a line-deleting edit (for example `sed -i.bak '/^OPENAI_API_KEY=/d' .env`),
  check, then delete the `.bak`. Never print the file.
- Keep or create `.env.example` with names only (`OPENAI_API_KEY=`) and a comment
  that values come from `ibyok run`.
- Make sure `.env*` (except `.env.example`) is in `.gitignore`.
- Prefix the scripts with `ibyok run --` (see `ibyok-setup` step 6).
- In CI, replace per-provider secrets with a single `IBYOK_ACCESS_TOKEN` secret and
  wrap the commands: `npx ibyok run --env staging -- npm test`.

## 6. Finish with rotation, not history rewriting

If step 1 found keys in git history or in a public repo, tell the user plainly:
**rotate those keys at the provider** (they already did if they stored new ones in
step 2), then delete the old ones. Offer history rewriting (`git filter-repo`) only
as an optional extra, and only with explicit approval.

Summarize: keys moved, files changed, scripts updated, anything the user still has to do.

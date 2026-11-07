/**
 * CLI commands.
 *
 * Conventions:
 * - Key VALUES are never printed, logged, or written to disk. Only `run`
 *   fetches them, and it hands them straight to the child process.
 * - Human-facing output from `run` goes to stderr, so the child's stdout
 *   stays clean for pipes.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { constants as osConstants } from 'node:os';
import {
  DASHBOARD_URL,
  DEFAULT_API_URL,
  Environment,
  IbyokClient,
  KeyInfo,
  parseEnvironment,
} from './api';
import {
  credentialsPath,
  deleteCredentials,
  resolveApiUrl,
  resolveToken,
  saveCredentials,
} from './credentials';
import { isValidEnvName, suggestEnvName, uniqueEnvName } from './env-names';
import { ApiError, CliError } from './errors';
import {
  CONFIG_FILENAME,
  LoadedConfig,
  ProjectConfig,
  loadConfig,
  requireConfig,
  writeConfig,
} from './project-config';
import { ask, askHidden, readAllStdin } from './prompt';
import { VERSION } from './version';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const out = (line = '') => process.stdout.write(line + '\n');
const info = (line = '') => process.stderr.write(line + '\n');

function requireClient(): IbyokClient {
  const resolved = resolveToken();
  if (!resolved) {
    throw new CliError(
      'Not logged in. Run `ibyok login` in your terminal, or set IBYOK_ACCESS_TOKEN.\n' +
        `Create a token (scope: keys:read) at ${DASHBOARD_URL}/tokens`
    );
  }
  return new IbyokClient(resolved.token, resolveApiUrl() ?? DEFAULT_API_URL);
}

/** --env flag > IBYOK_ENV > .ibyok.json "env" > development. */
export function resolveEnvironment(flag: string | undefined, config?: ProjectConfig): Environment {
  if (flag !== undefined) {
    const env = parseEnvironment(flag);
    if (!env) throw new CliError(`Invalid --env "${flag}". Use development, staging, or production.`);
    return env;
  }
  const fromVar = process.env.IBYOK_ENV;
  if (fromVar) {
    const env = parseEnvironment(fromVar);
    if (!env) throw new CliError(`Invalid IBYOK_ENV "${fromVar}". Use development, staging, or production.`);
    return env;
  }
  return config?.env ?? 'development';
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
  return rows.map((r) => r.map((cell, col) => cell.padEnd(widths[col])).join('  ').trimEnd()).join('\n');
}

function findKey(keys: KeyInfo[], ref: string): KeyInfo {
  const byId = keys.find((k) => k.keyId === ref);
  if (byId) return byId;
  const byName = keys.filter((k) => k.name.toLowerCase() === ref.toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new CliError(
      `More than one key is named "${ref}". Use a key ID instead: ${byName.map((k) => k.keyId).join(', ')}`
    );
  }
  throw new CliError(`No key with ID or name "${ref}". Run \`ibyok keys\` to list your keys.`);
}

// ---------------------------------------------------------------------------
// login / logout
// ---------------------------------------------------------------------------

export async function login(opts: { tokenStdin?: boolean; apiUrl?: string }): Promise<void> {
  let token: string;
  if (opts.tokenStdin) {
    token = (await readAllStdin()).trim();
  } else if (process.stdin.isTTY) {
    info(`Create an access token with the keys:read scope at ${DASHBOARD_URL}/tokens`);
    token = await askHidden('Paste your IBYOK access token (input hidden): ');
  } else {
    throw new CliError('stdin is not a terminal. Pipe the token in with `ibyok login --token-stdin`.');
  }
  if (!token) throw new CliError('No token provided.');

  const apiUrl = opts.apiUrl ?? process.env.IBYOK_API ?? DEFAULT_API_URL;
  const client = new IbyokClient(token, apiUrl);

  let keyCount: number | undefined;
  try {
    keyCount = (await client.listKeys()).length;
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'INSUFFICIENT_SCOPE') throw error;
    info('Warning: this token lacks the keys:read scope, so `ibyok run` will not work with it.');
  }

  const file = saveCredentials({
    token,
    apiUrl: apiUrl === DEFAULT_API_URL ? undefined : apiUrl,
    savedAt: new Date().toISOString(),
  });
  info(`Logged in. Token saved to ${file}`);
  if (keyCount !== undefined) info(`${keyCount} key${keyCount === 1 ? '' : 's'} available.`);
  if (process.env.IBYOK_ACCESS_TOKEN) {
    info('Note: IBYOK_ACCESS_TOKEN is set in this shell and takes precedence over the saved token.');
  }
}

export function logout(): void {
  info(deleteCredentials() ? `Removed ${credentialsPath()}` : 'Not logged in (no saved token).');
  if (process.env.IBYOK_ACCESS_TOKEN) info('Note: IBYOK_ACCESS_TOKEN is still set in this shell.');
}

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

export async function keys(opts: { env?: string; json?: boolean }): Promise<void> {
  const loaded = loadConfig();
  const env = resolveEnvironment(opts.env, loaded?.config);
  const list = await requireClient().listKeys(env);

  const mappedAs = new Map<string, string[]>();
  for (const [name, keyId] of Object.entries(loaded?.config.keys ?? {})) {
    mappedAs.set(keyId, [...(mappedAs.get(keyId) ?? []), name]);
  }

  if (opts.json) {
    out(JSON.stringify({ environment: env, keys: list.map((k) => ({ ...k, mappedAs: mappedAs.get(k.keyId) ?? [] })) }, null, 2));
    return;
  }
  if (list.length === 0) {
    out(`No keys stored yet. Add one at ${DASHBOARD_URL}/keys`);
    return;
  }
  out(`Keys (mode shown for ${env}):\n`);
  out(
    table([
      ['NAME', 'TYPE', 'KEY ID', 'MODE', 'MAPPED AS'],
      ...list.map((k) => [k.name, k.llmType, k.keyId, k.modeInfo.effectiveMode, (mappedAs.get(k.keyId) ?? []).join(', ') || '-']),
    ])
  );
}

// ---------------------------------------------------------------------------
// init / add / remove
// ---------------------------------------------------------------------------

export async function init(opts: { env?: string; all?: boolean; force?: boolean }): Promise<void> {
  const path = join(process.cwd(), CONFIG_FILENAME);
  if (existsSync(path) && !opts.force) {
    throw new CliError(`${CONFIG_FILENAME} already exists here. Use \`ibyok add\` to map more keys, or --force to overwrite.`);
  }

  const config: ProjectConfig = { env: resolveEnvironment(opts.env), keys: {} };

  if (resolveToken()) {
    const list = await requireClient().listKeys(config.env);
    const taken = new Set<string>();

    if (opts.all) {
      for (const k of list) {
        const name = uniqueEnvName(suggestEnvName(k.llmType, k.name), taken);
        taken.add(name);
        config.keys[name] = k.keyId;
      }
    } else if (process.stdin.isTTY && list.length > 0) {
      info('Map each key to the env var your app reads. Enter accepts the suggestion, "-" skips.\n');
      for (const k of list) {
        const suggestion = uniqueEnvName(suggestEnvName(k.llmType, k.name), taken);
        for (;;) {
          const answer = await ask(`  ${k.name} (${k.llmType}) → [${suggestion}]: `);
          if (answer === '-') break;
          const name = answer || suggestion;
          if (!isValidEnvName(name)) {
            info(`  "${name}" is not a valid env var name.`);
            continue;
          }
          if (taken.has(name)) {
            info(`  ${name} is already mapped.`);
            continue;
          }
          taken.add(name);
          config.keys[name] = k.keyId;
          break;
        }
      }
    } else if (list.length > 0) {
      info(`Found ${list.length} key(s). Map them with \`ibyok add <ENV_VAR> <key name or ID>\`, or rerun with --all.`);
    }
  } else {
    info('Not logged in, so no keys were mapped. Run `ibyok login`, then `ibyok add <ENV_VAR> <key>`.');
  }

  writeConfig(path, config);
  info(`\nWrote ${path} (env: ${config.env}, ${Object.keys(config.keys).length} key(s) mapped).`);
  for (const [name, keyId] of Object.entries(config.keys)) info(`  ${name} → ${keyId}`);
  info('\nThis file contains no secrets; commit it. Next:');
  info('  ibyok run -- <your command>      e.g. ibyok run -- npm run dev');
}

export async function add(envName: string, keyRef: string): Promise<void> {
  if (!isValidEnvName(envName)) throw new CliError(`"${envName}" is not a valid env var name.`);
  const loaded = requireConfig();
  const key = findKey(await requireClient().listKeys(loaded.config.env), keyRef);

  const previous = loaded.config.keys[envName];
  loaded.config.keys[envName] = key.keyId;
  writeConfig(loaded.path, loaded.config);
  info(`${previous ? 'Remapped' : 'Mapped'} ${envName} → "${key.name}" (${key.llmType}, ${key.keyId}) in ${loaded.path}`);
}

export function remove(envName: string): void {
  const loaded = requireConfig();
  if (!(envName in loaded.config.keys)) throw new CliError(`${envName} is not mapped in ${loaded.path}.`);
  delete loaded.config.keys[envName];
  writeConfig(loaded.path, loaded.config);
  info(`Removed ${envName} from ${loaded.path}`);
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function status(opts: { env?: string; json?: boolean }): Promise<number> {
  const problems: string[] = [];
  const resolved = resolveToken();
  const apiUrl = resolveApiUrl() ?? DEFAULT_API_URL;
  let loaded: LoadedConfig | undefined;
  try {
    loaded = loadConfig();
  } catch (error) {
    problems.push((error as Error).message);
  }
  const env = resolveEnvironment(opts.env, loaded?.config);

  let list: KeyInfo[] | undefined;
  let usage: Record<string, unknown> | undefined;
  if (!resolved) {
    problems.push('Not logged in. Run `ibyok login` or set IBYOK_ACCESS_TOKEN.');
  } else {
    const client = new IbyokClient(resolved.token, apiUrl);
    try {
      list = await client.listKeys(env);
    } catch (error) {
      problems.push((error as Error).message);
    }
    try {
      usage = await client.getUsage();
    } catch {
      // usage:read is optional
    }
  }

  const mappings = Object.entries(loaded?.config.keys ?? {}).map(([name, keyId]) => {
    const key = list?.find((k) => k.keyId === keyId);
    if (list && !key) problems.push(`${name} maps to ${keyId}, which this token cannot see (deleted, or another account's key).`);
    return { name, keyId, found: list ? Boolean(key) : null, keyName: key?.name, mode: key?.modeInfo.effectiveMode };
  });
  if (loaded && mappings.length === 0) problems.push(`No keys mapped in ${loaded.path}. Use \`ibyok add\`.`);
  if (!loaded) problems.push(`No ${CONFIG_FILENAME} found. Run \`ibyok init\`.`);

  if (opts.json) {
    out(
      JSON.stringify(
        {
          version: VERSION,
          apiUrl,
          auth: resolved ? { loggedIn: true, source: resolved.source } : { loggedIn: false },
          config: loaded?.path ?? null,
          environment: env,
          mappings,
          keysAvailable: list?.length ?? null,
          usage: usage ?? null,
          ok: problems.length === 0,
          problems,
        },
        null,
        2
      )
    );
    return problems.length ? 1 : 0;
  }

  out(`ibyok ${VERSION}  (${apiUrl})`);
  out(`Auth:        ${resolved ? (resolved.source === 'env' ? 'IBYOK_ACCESS_TOKEN env var' : `saved token (${credentialsPath()})`) : 'not logged in'}`);
  out(`Config:      ${loaded?.path ?? 'none'}`);
  out(`Environment: ${env}`);
  if (list) out(`Keys:        ${list.length} available to this token`);
  if (usage && typeof usage.externalCallsUsed === 'number') {
    out(`Usage:       ${usage.externalCallsUsed}/${usage.externalCallsLimit ?? '?'} live calls this period (${usage.tier ?? 'unknown'} tier)`);
  }
  if (mappings.length) {
    out('\nMappings:');
    for (const m of mappings) {
      const state = m.found === null ? 'unchecked' : m.found ? `${m.mode}, "${m.keyName}"` : 'MISSING';
      out(`  ${m.name} → ${m.keyId}  (${state})`);
    }
  }
  if (problems.length) {
    out('\nProblems:');
    for (const p of problems) out(`  - ${p}`);
  } else {
    out('\nAll good. `ibyok run -- <command>` will inject the mapped keys.');
  }
  return problems.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

export interface RunOptions {
  env?: string;
  only?: string[];
  dryRun?: boolean;
  quiet?: boolean;
}

export async function run(command: string[], opts: RunOptions): Promise<number> {
  if (command.length === 0) throw new CliError('Missing command. Usage: ibyok run [options] -- <command> [args...]');

  const loaded = requireConfig();
  const env = resolveEnvironment(opts.env, loaded.config);

  let mappings = Object.entries(loaded.config.keys);
  if (opts.only?.length) {
    const unknown = opts.only.filter((n) => !(n in loaded.config.keys));
    if (unknown.length) throw new CliError(`Not mapped in ${loaded.path}: ${unknown.join(', ')}`);
    mappings = mappings.filter(([name]) => opts.only!.includes(name));
  }
  if (mappings.length === 0) throw new CliError(`No keys mapped in ${loaded.path}. Use \`ibyok add\` first.`);

  const client = requireClient();

  // Validate every mapping with the unmetered list call before spending any
  // metered value calls, so a typo fails fast and free.
  const available = new Map((await client.listKeys(env)).map((k) => [k.keyId, k]));
  const missing = mappings.filter(([, keyId]) => !available.has(keyId));
  if (missing.length) {
    throw new CliError(
      `These mappings point at keys this token cannot see: ${missing.map(([n, id]) => `${n} (${id})`).join(', ')}.\n` +
        'Run `ibyok keys` and fix them with `ibyok add`.'
    );
  }

  const describe = (name: string, keyId: string) => `${name} (${available.get(keyId)!.modeInfo.effectiveMode})`;

  if (opts.dryRun) {
    info(`ibyok: would inject into \`${command.join(' ')}\` [${env}]:`);
    for (const [name, keyId] of mappings) info(`  ${describe(name, keyId)} ← "${available.get(keyId)!.name}"`);
    return 0;
  }

  // All-or-nothing: if any value fails, don't start the command with a
  // partial environment.
  const values = await Promise.all(mappings.map(async ([name, keyId]) => [name, (await client.getKeyValue(keyId, env)).value] as const));

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.IBYOK_ACCESS_TOKEN; // the child gets provider keys, never the IBYOK token
  const overridden: string[] = [];
  for (const [name, value] of values) {
    if (childEnv[name] !== undefined) overridden.push(name);
    childEnv[name] = value;
  }

  if (!opts.quiet) {
    info(`ibyok: injected ${mappings.map(([n, id]) => describe(n, id)).join(', ')} [${env}]`);
    if (overridden.length) info(`ibyok: overrode existing ${overridden.join(', ')} from the parent environment`);
  }

  return spawnAndWait(command, childEnv);
}

function spawnAndWait(command: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    });

    // The terminal sends Ctrl-C to the whole process group; stay alive until
    // the child exits so we can return its status. Forward signals that only
    // reached us (e.g. `kill <pid>` from a supervisor).
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const forward = (signal: NodeJS.Signals) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    for (const s of signals) process.on(s, forward);
    const cleanup = () => {
      for (const s of signals) process.removeListener(s, forward);
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(
        error.code === 'ENOENT'
          ? new CliError(`Command not found: ${command[0]}`, 127)
          : new CliError(`Failed to start ${command[0]}: ${error.message}`)
      );
    });
    child.on('exit', (code, signal) => {
      cleanup();
      if (signal) {
        const num = (osConstants.signals as Record<string, number>)[signal] ?? 1;
        resolve(128 + num);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

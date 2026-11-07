/**
 * Project config: `.ibyok.json`.
 *
 * Maps env var names to IBYOK key IDs. It contains no secrets (a key ID is
 * useless without an access token), so it is meant to be committed.
 *
 *   {
 *     "env": "development",
 *     "keys": { "OPENAI_API_KEY": "01KMDK9XF2W0RQ7F27KKPPNJK7" }
 *   }
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Environment, parseEnvironment } from './api';
import { isValidEnvName } from './env-names';
import { CliError } from './errors';

export const CONFIG_FILENAME = '.ibyok.json';

export interface ProjectConfig {
  env?: Environment;
  keys: Record<string, string>;
}

export interface LoadedConfig {
  path: string;
  config: ProjectConfig;
}

/** Find `.ibyok.json` in `startDir` or the nearest parent directory. */
export function findConfigPath(startDir: string = process.cwd()): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function parseConfig(text: string, path: string): ProjectConfig {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new CliError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CliError(`${path} must contain a JSON object.`);
  }

  const config: ProjectConfig = { keys: {} };

  if (raw.env !== undefined) {
    const env = typeof raw.env === 'string' ? parseEnvironment(raw.env) : undefined;
    if (!env) throw new CliError(`${path}: "env" must be development, staging, or production.`);
    config.env = env;
  }

  if (raw.keys !== undefined) {
    if (!raw.keys || typeof raw.keys !== 'object' || Array.isArray(raw.keys)) {
      throw new CliError(`${path}: "keys" must be an object of ENV_VAR_NAME: keyId.`);
    }
    for (const [name, keyId] of Object.entries(raw.keys)) {
      if (!isValidEnvName(name)) throw new CliError(`${path}: "${name}" is not a valid env var name.`);
      if (typeof keyId !== 'string' || !keyId) throw new CliError(`${path}: "${name}" must map to a key ID string.`);
      config.keys[name] = keyId;
    }
  }

  return config;
}

export function loadConfig(startDir?: string): LoadedConfig | undefined {
  const path = findConfigPath(startDir);
  if (!path) return undefined;
  return { path, config: parseConfig(readFileSync(path, 'utf8'), path) };
}

export function requireConfig(startDir?: string): LoadedConfig {
  const loaded = loadConfig(startDir);
  if (!loaded) {
    throw new CliError(`No ${CONFIG_FILENAME} found in this directory or any parent. Run \`ibyok init\` first.`);
  }
  return loaded;
}

export function writeConfig(path: string, config: ProjectConfig): void {
  const sortedKeys = Object.fromEntries(Object.entries(config.keys).sort(([a], [b]) => a.localeCompare(b)));
  const out: Record<string, unknown> = {};
  if (config.env) out.env = config.env;
  out.keys = sortedKeys;
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
}

/**
 * Access token storage.
 *
 * Resolution order:
 *   1. IBYOK_ACCESS_TOKEN env var (CI, containers)
 *   2. The user credentials file written by `ibyok login`
 *
 * The file lives in the user's config dir (never in the project), with
 * 0600 permissions inside a 0700 directory.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface StoredCredentials {
  token: string;
  apiUrl?: string;
  savedAt: string;
}

export interface ResolvedToken {
  token: string;
  source: 'env' | 'file';
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.IBYOK_CONFIG_DIR) return env.IBYOK_CONFIG_DIR;
  if (process.platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'ibyok');
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'ibyok');
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'credentials.json');
}

export function readStoredCredentials(env: NodeJS.ProcessEnv = process.env): StoredCredentials | undefined {
  const file = credentialsPath(env);
  if (!existsSync(file)) return undefined;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return typeof data?.token === 'string' && data.token ? (data as StoredCredentials) : undefined;
  } catch {
    return undefined;
  }
}

export function saveCredentials(creds: StoredCredentials, env: NodeJS.ProcessEnv = process.env): string {
  const file = credentialsPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync only applies `mode` when creating the file.
  chmodSync(file, 0o600);
  return file;
}

export function deleteCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  const file = credentialsPath(env);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

export function resolveToken(env: NodeJS.ProcessEnv = process.env): ResolvedToken | undefined {
  const fromEnv = env.IBYOK_ACCESS_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: 'env' };
  const stored = readStoredCredentials(env);
  if (stored) return { token: stored.token, source: 'file' };
  return undefined;
}

export function resolveApiUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.IBYOK_API?.trim() || readStoredCredentials(env)?.apiUrl || undefined;
}

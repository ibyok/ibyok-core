/**
 * End-to-end tests: the built CLI against a fake IBYOK API.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(__dirname, '../../dist/cli.js');
const GOOD_TOKEN = 'ibyok_goodtoken';
const SECRET_OPENAI = 'sk-live-SECRET-openai-value';
const SECRET_GITHUB = 'ghp_SECRET-github-value';

const KEYS = [
  { keyId: 'k_openai', name: 'openai', llmType: 'openai', value: SECRET_OPENAI },
  { keyId: 'k_github', name: 'github', llmType: 'custom', value: SECRET_GITHUB },
];

let server: Server;
let apiUrl: string;
let valueCalls: string[] = [];
let failValueFor: string | undefined;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${GOOD_TOKEN}`) {
      return send(401, { error: 'unauthorized', code: 'INVALID_TOKEN', message: 'Invalid or expired API token' });
    }
    const env = url.searchParams.get('env') ?? 'production';
    const modeInfo = { environment: env, effectiveMode: env === 'production' ? 'live' : 'mock', source: 'tenant_setting' };

    if (url.pathname === '/external/keys') {
      return send(200, {
        keys: KEYS.map(({ value: _v, ...k }) => ({ ...k, modeInfo, lastUsed: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' })),
      });
    }
    const m = url.pathname.match(/^\/external\/keys\/([^/]+)\/value$/);
    if (m) {
      valueCalls.push(m[1]);
      if (failValueFor === m[1]) return send(429, { code: 'QUOTA_EXCEEDED', message: 'limit reached.' });
      const key = KEYS.find((k) => k.keyId === m[1]);
      if (!key) return send(404, { code: 'KEY_NOT_FOUND', message: `Key not found: ${m[1]}` });
      return send(200, { keyId: key.keyId, name: key.name, llmType: key.llmType, value: key.value, modeInfo });
    }
    if (url.pathname === '/external/usage') {
      return send(200, { tier: 'free', externalCallsUsed: 3, externalCallsLimit: 500 });
    }
    send(404, { code: 'NOT_FOUND' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

let project: string;
let configDir: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'ibyok-project-'));
  configDir = mkdtempSync(join(tmpdir(), 'ibyok-config-'));
  valueCalls = [];
  failValueFor = undefined;
});

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

function cli(args: string[], opts: { env?: Record<string, string | undefined>; input?: string } = {}): Promise<Result> {
  return new Promise((resolvePromise) => {
    const env: NodeJS.ProcessEnv = { ...process.env, IBYOK_API: apiUrl, IBYOK_CONFIG_DIR: configDir, ...opts.env };
    delete env.IBYOK_ENV;
    if (!opts.env || !('IBYOK_ACCESS_TOKEN' in opts.env)) delete env.IBYOK_ACCESS_TOKEN;
    const child = spawn(process.execPath, [CLI, ...args], { cwd: project, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.stdin.end(opts.input ?? '');
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const authed = { env: { IBYOK_ACCESS_TOKEN: GOOD_TOKEN } };

test('login --token-stdin saves the token with 0600 permissions', async () => {
  const r = await cli(['login', '--token-stdin'], { input: GOOD_TOKEN + '\n' });
  assert.equal(r.code, 0, r.stderr);
  const file = join(configDir, 'credentials.json');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, GOOD_TOKEN);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.match(r.stderr, /2 keys available/);
  assert.doesNotMatch(r.stdout + r.stderr, /goodtoken/);
});

test('login rejects a bad token and saves nothing', async () => {
  const r = await cli(['login', '--token-stdin'], { input: 'ibyok_bad' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /invalid or expired/i);
  assert.equal(existsSync(join(configDir, 'credentials.json')), false);
});

test('commands that need auth explain how to log in', async () => {
  const r = await cli(['keys']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Not logged in/);
});

test('init --all maps every key with suggested names and defaults to development', async () => {
  const r = await cli(['init', '--all'], authed);
  assert.equal(r.code, 0, r.stderr);
  const config = JSON.parse(readFileSync(join(project, '.ibyok.json'), 'utf8'));
  assert.deepEqual(config, { env: 'development', keys: { GITHUB_API_KEY: 'k_github', OPENAI_API_KEY: 'k_openai' } });
  const again = await cli(['init', '--all'], authed);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already exists/);
});

test('add resolves keys by name, remove deletes mappings', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{}}');
  assert.equal((await cli(['add', 'MY_GH', 'GitHub'], authed)).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(project, '.ibyok.json'), 'utf8')).keys, { MY_GH: 'k_github' });
  const bad = await cli(['add', 'X_KEY', 'nope'], authed);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /No key with ID or name "nope"/);
  assert.equal((await cli(['remove', 'MY_GH'], authed)).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(project, '.ibyok.json'), 'utf8')).keys, {});
});

test('keys lists metadata and never values', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"OPENAI_API_KEY":"k_openai"}}');
  const r = await cli(['keys'], authed);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /k_openai\s+mock\s+OPENAI_API_KEY/);
  assert.doesNotMatch(r.stdout + r.stderr, /SECRET/);
  assert.deepEqual(valueCalls, []);
});

const PRINT_CHILD_ENV =
  'process.stdout.write(JSON.stringify({o: process.env.OPENAI_API_KEY, g: process.env.GITHUB_API_KEY, t: process.env.IBYOK_ACCESS_TOKEN ?? null}))';

test('run injects values into the child only, and strips the IBYOK token', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"OPENAI_API_KEY":"k_openai","GITHUB_API_KEY":"k_github"}}');
  const r = await cli(['run', '--', process.execPath, '-e', PRINT_CHILD_ENV], authed);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { o: SECRET_OPENAI, g: SECRET_GITHUB, t: null });
  assert.match(r.stderr, /injected OPENAI_API_KEY \(mock\), GITHUB_API_KEY \(mock\) \[development\]/);
  assert.doesNotMatch(r.stderr, /SECRET/);
  assert.deepEqual(valueCalls.sort(), ['k_github', 'k_openai']);
});

test('run --only and --env are honored', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"OPENAI_API_KEY":"k_openai","GITHUB_API_KEY":"k_github"}}');
  const r = await cli(['run', '--env', 'prod', '--only', 'OPENAI_API_KEY', '--', process.execPath, '-e', PRINT_CHILD_ENV], authed);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { o: SECRET_OPENAI, t: null });
  assert.match(r.stderr, /OPENAI_API_KEY \(live\) \[production\]/);
  assert.deepEqual(valueCalls, ['k_openai']);
});

test('run propagates the child exit code', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"OPENAI_API_KEY":"k_openai"}}');
  const r = await cli(['run', '-q', '--', process.execPath, '-e', 'process.exit(7)'], authed);
  assert.equal(r.code, 7);
  assert.equal(r.stderr, '');
});

test('run --dry-run fetches no values', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"OPENAI_API_KEY":"k_openai"}}');
  const r = await cli(['run', '--dry-run', '--', 'anything'], authed);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /would inject/);
  assert.deepEqual(valueCalls, []);
});

test('run fails before any metered call when a mapping is stale', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"OPENAI_API_KEY":"k_openai","GONE_KEY":"k_deleted"}}');
  const r = await cli(['run', '--', process.execPath, '-e', 'console.log("started")'], authed);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /GONE_KEY \(k_deleted\)/);
  assert.doesNotMatch(r.stdout, /started/);
  assert.deepEqual(valueCalls, []);
});

test('run does not start the command if any value fetch fails', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"OPENAI_API_KEY":"k_openai","GITHUB_API_KEY":"k_github"}}');
  failValueFor = 'k_github';
  const r = await cli(['run', '--', process.execPath, '-e', 'console.log("started")'], authed);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Mock-mode calls are not limited/);
  assert.doesNotMatch(r.stdout, /started/);
});

test('run reports a missing command clearly', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"OPENAI_API_KEY":"k_openai"}}');
  const r = await cli(['run', '--', 'definitely-not-a-command-xyz'], authed);
  assert.equal(r.code, 127);
  assert.match(r.stderr, /Command not found/);
});

test('status --json reports ok and problems', async () => {
  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"OPENAI_API_KEY":"k_openai"}}');
  const ok = await cli(['status', '--json'], authed);
  assert.equal(ok.code, 0, ok.stderr);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.auth.source, 'env');
  assert.equal(report.usage.externalCallsUsed, 3);

  writeFileSync(join(project, '.ibyok.json'), '{"keys":{"X_KEY":"k_deleted"}}');
  const bad = await cli(['status', '--json'], authed);
  assert.equal(bad.code, 1);
  assert.match(JSON.parse(bad.stdout).problems.join('\n'), /X_KEY maps to k_deleted/);
});

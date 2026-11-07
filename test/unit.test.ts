import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suggestEnvName, uniqueEnvName, isValidEnvName } from '../src/env-names';
import { findConfigPath, parseConfig } from '../src/project-config';
import { parseEnvironment } from '../src/api';
import { splitRunArgs } from '../src/cli';
import { CliError } from '../src/errors';

test('suggestEnvName uses SDK conventions for known providers', () => {
  assert.equal(suggestEnvName('openai', 'prod'), 'OPENAI_API_KEY');
  assert.equal(suggestEnvName('anthropic', 'x'), 'ANTHROPIC_API_KEY');
  assert.equal(suggestEnvName('google', 'x'), 'GEMINI_API_KEY');
  assert.equal(suggestEnvName('huggingface', 'x'), 'HF_TOKEN');
});

test('suggestEnvName derives names for custom and unknown types', () => {
  assert.equal(suggestEnvName('custom', 'github'), 'GITHUB_API_KEY');
  assert.equal(suggestEnvName('custom', 'Stripe secret key'), 'STRIPE_SECRET_KEY');
  assert.equal(suggestEnvName('custom', '2captcha'), '_2CAPTCHA_API_KEY');
  assert.equal(suggestEnvName('alibaba-qwen', 'x'), 'ALIBABA_QWEN_API_KEY');
  assert.ok(isValidEnvName(suggestEnvName('custom', '!!!')));
});

test('uniqueEnvName suffixes collisions', () => {
  assert.equal(uniqueEnvName('A', new Set()), 'A');
  assert.equal(uniqueEnvName('A', new Set(['A', 'A_2'])), 'A_3');
});

test('parseEnvironment accepts short and long forms', () => {
  assert.equal(parseEnvironment('dev'), 'development');
  assert.equal(parseEnvironment('Stage'), 'staging');
  assert.equal(parseEnvironment('prod'), 'production');
  assert.equal(parseEnvironment('qa'), undefined);
});

test('parseConfig validates shape', () => {
  assert.deepEqual(parseConfig('{"env":"dev","keys":{"A_KEY":"k1"}}', 'f'), { env: 'development', keys: { A_KEY: 'k1' } });
  assert.throws(() => parseConfig('{"keys":{"1BAD":"k"}}', 'f'), CliError);
  assert.throws(() => parseConfig('{"env":"qa"}', 'f'), CliError);
  assert.throws(() => parseConfig('not json', 'f'), CliError);
});

test('findConfigPath searches parent directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'ibyok-'));
  const nested = join(root, 'a', 'b');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, '.ibyok.json'), '{}');
  assert.equal(findConfigPath(nested), join(root, '.ibyok.json'));
});

test('splitRunArgs separates options from the command', () => {
  assert.deepEqual(splitRunArgs(['--env', 'prod', '--', 'npm', 'start', '--port', '3']), {
    options: { env: 'prod' },
    command: ['npm', 'start', '--port', '3'],
  });
  assert.deepEqual(splitRunArgs(['-q', 'node', 'app.js', '--env', 'x']), {
    options: { quiet: true },
    command: ['node', 'app.js', '--env', 'x'],
  });
  assert.deepEqual(splitRunArgs(['--only=A,B', '--dry-run', '--', 'x']).options, { only: ['A', 'B'], dryRun: true });
  assert.throws(() => splitRunArgs(['--port', '3']), CliError);
});

#!/usr/bin/env node
/**
 * ibyok: inject IBYOK-stored API keys into commands at runtime.
 */

import { parseArgs } from 'node:util';
import * as commands from './commands';
import { CliError } from './errors';
import { VERSION } from './version';

const HELP = `ibyok ${VERSION}: run commands with your IBYOK-stored API keys

Usage:
  ibyok login [--token-stdin] [--api <url>]   Save an access token (prompted, hidden)
  ibyok logout                                Remove the saved token
  ibyok init [--env <env>] [--all] [--force]  Create .ibyok.json in this directory
  ibyok keys [--env <env>] [--json]           List your keys (no values)
  ibyok add <ENV_VAR> <key name or ID>        Map an env var to a key
  ibyok remove <ENV_VAR>                      Remove a mapping
  ibyok status [--env <env>] [--json]         Check auth, config, and mappings
  ibyok run [options] -- <command> [args...]  Run a command with the keys injected

Run options:
  -e, --env <env>        development | staging | production (default: .ibyok.json "env",
                         then IBYOK_ENV, then development)
  --only <A,B>           Inject only these env vars
  --dry-run              Validate mappings and show what would be injected; fetch no values
  -q, --quiet            Don't print the injection summary

Environment:
  IBYOK_ACCESS_TOKEN     Access token (overrides the saved one; use in CI)
  IBYOK_ENV              Default environment
  IBYOK_API              API base URL (default https://api.ibyok.com)

Key values are never printed or written to disk. Docs: https://github.com/ibyok/ibyok-core
`;

type Handler = (args: string[]) => Promise<number | void> | number | void;

function parse(args: string[], options: NonNullable<Parameters<typeof parseArgs>[0]>['options'], maxPositionals: number) {
  try {
    const result = parseArgs({ args, options, allowPositionals: true, strict: true });
    if (result.positionals.length > maxPositionals) {
      throw new CliError(`Unexpected argument: ${result.positionals[maxPositionals]}`);
    }
    return result as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`${(error as Error).message}\nRun \`ibyok help\` for usage.`);
  }
}

const envOption = { env: { type: 'string', short: 'e' } } as const;
const jsonOption = { json: { type: 'boolean' } } as const;

/** Split `run` args into ibyok options and the command (everything after `--` or the first non-option). */
export function splitRunArgs(args: string[]): { options: commands.RunOptions; command: string[] } {
  const options: commands.RunOptions = {};
  let i = 0;
  const takeValue = (flag: string) => {
    const value = args[++i];
    if (value === undefined) throw new CliError(`${flag} needs a value.`);
    return value;
  };
  for (; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      i++;
      break;
    }
    if (arg === '-e' || arg === '--env') options.env = takeValue(arg);
    else if (arg.startsWith('--env=')) options.env = arg.slice('--env='.length);
    else if (arg === '--only') options.only = takeValue(arg).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--only=')) options.only = arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '-q' || arg === '--quiet') options.quiet = true;
    else if (arg.startsWith('-')) throw new CliError(`Unknown run option: ${arg}. Put your command after \`--\`.`);
    else break;
  }
  return { options, command: args.slice(i) };
}

const handlers: Record<string, Handler> = {
  login: (args) => {
    const { values } = parse(args, { 'token-stdin': { type: 'boolean' }, api: { type: 'string' } }, 0);
    return commands.login({ tokenStdin: values['token-stdin'] as boolean, apiUrl: values.api as string | undefined });
  },
  logout: (args) => {
    parse(args, {}, 0);
    commands.logout();
  },
  init: (args) => {
    const { values } = parse(args, { ...envOption, all: { type: 'boolean' }, force: { type: 'boolean' } }, 0);
    return commands.init({ env: values.env as string | undefined, all: values.all as boolean, force: values.force as boolean });
  },
  keys: (args) => {
    const { values } = parse(args, { ...envOption, ...jsonOption }, 0);
    return commands.keys({ env: values.env as string | undefined, json: values.json as boolean });
  },
  add: (args) => {
    const { positionals } = parse(args, {}, 2);
    if (positionals.length !== 2) throw new CliError('Usage: ibyok add <ENV_VAR> <key name or ID>');
    return commands.add(positionals[0], positionals[1]);
  },
  remove: (args) => {
    const { positionals } = parse(args, {}, 1);
    if (positionals.length !== 1) throw new CliError('Usage: ibyok remove <ENV_VAR>');
    commands.remove(positionals[0]);
  },
  status: (args) => {
    const { values } = parse(args, { ...envOption, ...jsonOption }, 0);
    return commands.status({ env: values.env as string | undefined, json: values.json as boolean });
  },
  run: (args) => {
    const { options, command } = splitRunArgs(args);
    return commands.run(command, options);
  },
};
handlers.ls = handlers.keys;
handlers.rm = handlers.remove;

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (name === '--version' || name === '-v' || name === 'version') {
    process.stdout.write(VERSION + '\n');
    return 0;
  }
  const handler = handlers[name];
  if (!handler) throw new CliError(`Unknown command: ${name}\nRun \`ibyok help\` for usage.`);
  const code = await handler(rest);
  return typeof code === 'number' ? code : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      if (error instanceof CliError) {
        process.stderr.write(`ibyok: ${error.message}\n`);
        process.exitCode = error.exitCode;
      } else {
        process.stderr.write(`ibyok: unexpected error: ${error?.stack ?? error}\n`);
        process.exitCode = 1;
      }
    }
  );
}

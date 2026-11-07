/**
 * Terminal prompts. Both read from the TTY; callers must check
 * `process.stdin.isTTY` first and fall back to flags otherwise.
 */

import { createInterface } from 'node:readline';
import { CliError } from './errors';

export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Read a line without echoing it (for tokens). */
export function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(new CliError('Cannot prompt for a hidden value: stdin is not a terminal.'));
  }

  // Disable echo before showing the prompt, so nothing typed or pasted in
  // response to it can be echoed.
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  process.stderr.write(question);

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') return finish();
        if (char === '\u0003') return finish(new CliError('Cancelled.', 130));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });
}

export async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

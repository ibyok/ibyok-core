import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readVersion(): string {
  // dist/version.js and dist-test/src/version.js both sit below package.json.
  for (const rel of ['..', '../..']) {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, rel, 'package.json'), 'utf8'));
      if (pkg.name === 'ibyok' && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // keep looking
    }
  }
  return '0.0.0';
}

export const VERSION = readVersion();

#!/usr/bin/env node
// Copy packages/web/dist into <comfy-base>/web/extensions/relit/.
// Override the destination via $RELIT_INSTALL_DIR or the first CLI arg.

import { existsSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const distDir = resolve(new URL('..', import.meta.url).pathname, 'dist');
if (!existsSync(distDir)) {
  process.stderr.write(`Build first: pnpm --filter @relit/web build\n  (no dist at ${distDir})\n`);
  process.exit(1);
}

const target = process.env.RELIT_INSTALL_DIR ?? process.argv[2] ?? guessDefault();

if (!target) {
  process.stderr.write(
    'Could not guess a default install dir. Pass one as $RELIT_INSTALL_DIR or argv[2].\n',
  );
  process.exit(1);
}

mkdirSync(target, { recursive: true });
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(distDir, target, { recursive: true });
process.stdout.write(`Installed to ${target}\n`);

function guessDefault() {
  const candidates = [
    join(homedir(), 'Documents', 'ComfyUI', 'web', 'extensions', 'relit'),
    join(homedir(), 'ComfyUI', 'web', 'extensions', 'relit'),
  ];
  for (const c of candidates) {
    const parent = c.replace(/\\/g, '/').split('/').slice(0, -3).join('/');
    if (parent && existsSync(parent)) return c;
  }
  return undefined;
}

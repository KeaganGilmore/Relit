#!/usr/bin/env node
// Install Relit as a ComfyUI custom_node:
//   <comfy-base>/custom_nodes/relit/
//     __init__.py    — registers /relit HTTP routes
//     web/           — copied from packages/web/dist
//
// Override the ComfyUI base directory via $RELIT_COMFY_BASE or the first CLI
// arg. Default guesses common Windows / *nix install paths.

import { existsSync, mkdirSync, rmSync, cpSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(scriptDir, '..', 'dist');
const initSrc = resolve(scriptDir, 'comfy_init.py');

if (!existsSync(distDir)) {
  process.stderr.write(`Build first: pnpm --filter @relit/web build\n  (no dist at ${distDir})\n`);
  process.exit(1);
}
if (!existsSync(initSrc)) {
  process.stderr.write(`Missing comfy_init.py next to this script: ${initSrc}\n`);
  process.exit(1);
}

const comfyBase = process.env.RELIT_COMFY_BASE ?? process.argv[2] ?? guessBase();
if (!comfyBase) {
  process.stderr.write(
    'Could not find a ComfyUI base directory. Pass one as $RELIT_COMFY_BASE or argv[2]\n' +
      '(the directory that contains a `custom_nodes` folder).\n',
  );
  process.exit(1);
}

const customNodesDir = join(comfyBase, 'custom_nodes');
if (!existsSync(customNodesDir)) {
  process.stderr.write(
    `Found base ${comfyBase} but no custom_nodes/ inside it. Wrong path?\n`,
  );
  process.exit(1);
}

const target = join(customNodesDir, 'relit');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
copyFileSync(initSrc, join(target, '__init__.py'));
cpSync(distDir, join(target, 'web'), { recursive: true });

process.stdout.write(`Installed to ${target}\n`);
process.stdout.write('Restart ComfyUI, then open http://<your-comfyui-host>/relit\n');

function guessBase() {
  const candidates = [
    join(homedir(), 'Documents', 'ComfyUI'),
    join(homedir(), 'ComfyUI'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'custom_nodes'))) return c;
  }
  return undefined;
}

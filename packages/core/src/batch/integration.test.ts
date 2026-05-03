import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ComfyClient } from '../comfy/client.js';
import { ok, err } from '../result.js';
import type { FileSystem } from '../fs/types.js';
import { passthroughWorkflow } from '../workflows/passthrough.js';
import { BatchRunner } from './runner.js';

const live = process.env['RELIT_LIVE'] === '1';
const baseUrl = process.env['RELIT_COMFY_URL'] ?? 'http://localhost:8188';
const describeLive = live ? describe : describe.skip;

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const decodeBase64 = (b64: string): Uint8Array =>
  typeof Buffer !== 'undefined'
    ? new Uint8Array(Buffer.from(b64, 'base64'))
    : new Uint8Array(
        atob(b64)
          .split('')
          .map((c) => c.charCodeAt(0)),
      );

const makeNodeFs = (inputDir: string, outputDir: string): FileSystem => ({
  async listInputs() {
    try {
      return ok(readdirSync(inputDir).map((name) => ({ name })));
    } catch (e) {
      return err({ kind: 'io', path: inputDir, message: String(e) });
    }
  },
  async readInput(name) {
    try {
      return ok(new Uint8Array(readFileSync(join(inputDir, name))));
    } catch {
      return err({ kind: 'not_found', path: join(inputDir, name) });
    }
  },
  async writeOutput(name, bytes) {
    try {
      writeFileSync(join(outputDir, name), bytes);
      return ok(undefined);
    } catch (e) {
      return err({ kind: 'io', path: join(outputDir, name), message: String(e) });
    }
  },
  async outputExists(name) {
    try {
      readFileSync(join(outputDir, name));
      return ok(true);
    } catch {
      return ok(false);
    }
  },
});

describeLive(`BatchRunner end-to-end against live ComfyUI at ${baseUrl}`, () => {
  it('passthrough relights a real image and writes it to disk', async () => {
    const work = mkdtempSync(join(tmpdir(), 'relit-it-'));
    const inputDir = join(work, 'in');
    const outputDir = join(work, 'out');
    mkdirSync(inputDir);
    mkdirSync(outputDir);
    writeFileSync(join(inputDir, 'photo.png'), decodeBase64(TINY_PNG_BASE64));

    const comfy = new ComfyClient({ baseUrl });
    const runner = new BatchRunner({ comfy, fs: makeNodeFs(inputDir, outputDir) });

    const summary = await runner.run({
      definition: passthroughWorkflow,
      inputs: ['photo.png'],
      outputSuffix: '_relit',
    });

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    const outputs = readdirSync(outputDir);
    expect(outputs).toContain('photo_relit.png');
  }, 60_000);
});

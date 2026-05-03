import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  err,
  ok,
  type FileSystem,
  type FsEntry,
  type FsError,
  type Result,
  looksLikeImage,
} from '@relit/core';

const wrap = (path: string, e: unknown): FsError => {
  if (e instanceof Error && 'code' in e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'not_found', path };
    if (code === 'EACCES' || code === 'EPERM') {
      return { kind: 'permission', path, message: e.message };
    }
    if (code === 'EEXIST') return { kind: 'exists', path };
  }
  return { kind: 'io', path, message: e instanceof Error ? e.message : String(e) };
};

export interface NodeFsOptions {
  readonly inputDir: string;
  readonly outputDir: string;
}

export const createNodeFs = (opts: NodeFsOptions): FileSystem => ({
  async listInputs(): Promise<Result<readonly FsEntry[], FsError>> {
    try {
      const names = await fs.readdir(opts.inputDir);
      return ok(
        names
          .filter(looksLikeImage)
          .sort((a, b) => a.localeCompare(b))
          .map<FsEntry>((name) => ({ name })),
      );
    } catch (e) {
      return err(wrap(opts.inputDir, e));
    }
  },

  async readInput(name: string): Promise<Result<Uint8Array, FsError>> {
    const path = join(opts.inputDir, name);
    try {
      const buf = await fs.readFile(path);
      return ok(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    } catch (e) {
      return err(wrap(path, e));
    }
  },

  async writeOutput(
    name: string,
    bytes: Uint8Array,
    writeOpts: { readonly overwrite?: boolean } = {},
  ): Promise<Result<void, FsError>> {
    const path = join(opts.outputDir, name);
    try {
      await fs.mkdir(opts.outputDir, { recursive: true });
      const flag = writeOpts.overwrite ? 'w' : 'wx';
      await fs.writeFile(path, bytes, { flag });
      return ok(undefined);
    } catch (e) {
      return err(wrap(path, e));
    }
  },

  async outputExists(name: string): Promise<Result<boolean, FsError>> {
    const path = join(opts.outputDir, name);
    try {
      await fs.access(path);
      return ok(true);
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') {
        return ok(false);
      }
      return err(wrap(path, e));
    }
  },
});

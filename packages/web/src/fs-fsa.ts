import {
  err,
  ok,
  type FileSystem,
  type FsEntry,
  type FsError,
  type Result,
  looksLikeImage,
} from '@relit/core';

declare global {
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
    getDirectoryHandle(
      name: string,
      options?: { create?: boolean },
    ): Promise<FileSystemDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    removeEntry(name: string): Promise<void>;
  }
}

const wrap = (path: string, e: unknown): FsError => {
  if (e instanceof DOMException) {
    if (e.name === 'NotFoundError') return { kind: 'not_found', path };
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      return { kind: 'permission', path, message: e.message };
    }
  }
  return { kind: 'io', path, message: e instanceof Error ? e.message : String(e) };
};

export interface FsaFsOptions {
  readonly inputDir: FileSystemDirectoryHandle;
  readonly outputDir: FileSystemDirectoryHandle;
}

export const createFsaFs = (opts: FsaFsOptions): FileSystem => ({
  async listInputs(): Promise<Result<readonly FsEntry[], FsError>> {
    try {
      const out: FsEntry[] = [];
      for await (const handle of opts.inputDir.values()) {
        if (handle.kind === 'file' && looksLikeImage(handle.name)) {
          out.push({ name: handle.name });
        }
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return ok(out);
    } catch (e) {
      return err(wrap(opts.inputDir.name, e));
    }
  },

  async readInput(name: string): Promise<Result<Uint8Array, FsError>> {
    try {
      const fh = await opts.inputDir.getFileHandle(name);
      const file = await fh.getFile();
      const buf = await file.arrayBuffer();
      return ok(new Uint8Array(buf));
    } catch (e) {
      return err(wrap(name, e));
    }
  },

  async writeOutput(
    name: string,
    bytes: Uint8Array,
    writeOpts: { readonly overwrite?: boolean } = {},
  ): Promise<Result<void, FsError>> {
    try {
      if (!writeOpts.overwrite) {
        try {
          await opts.outputDir.getFileHandle(name);
          return err({ kind: 'exists', path: name });
        } catch (e) {
          if (!(e instanceof DOMException) || e.name !== 'NotFoundError') throw e;
        }
      }
      const fh = await opts.outputDir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      const blob = new Blob([new Uint8Array(bytes) as BlobPart]);
      await w.write(blob);
      await w.close();
      return ok(undefined);
    } catch (e) {
      return err(wrap(name, e));
    }
  },

  async outputExists(name: string): Promise<Result<boolean, FsError>> {
    try {
      await opts.outputDir.getFileHandle(name);
      return ok(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return ok(false);
      return err(wrap(name, e));
    }
  },
});

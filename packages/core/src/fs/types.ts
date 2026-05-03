import type { Result } from '../result.js';

export type FsError =
  | { readonly kind: 'not_found'; readonly path: string }
  | { readonly kind: 'permission'; readonly path: string; readonly message: string }
  | { readonly kind: 'exists'; readonly path: string }
  | { readonly kind: 'io'; readonly path: string; readonly message: string };

export interface FsEntry {
  readonly name: string;
  readonly mime?: string;
}

/**
 * Minimal filesystem interface used by BatchRunner. Same contract for the
 * Node CLI (backed by node:fs) and the browser (backed by File System Access
 * API). All paths are *relative to the configured input/output directories*
 * the implementation was constructed with — implementations resolve the rest.
 */
export interface FileSystem {
  /** List image-like entries (png/jpg/jpeg/webp) in the input dir. Order is implementation-defined. */
  listInputs(): Promise<Result<readonly FsEntry[], FsError>>;
  /** Read raw bytes for an input entry. */
  readInput(name: string): Promise<Result<Uint8Array, FsError>>;
  /** Write raw bytes to an output entry. `overwrite` controls collision handling. */
  writeOutput(
    name: string,
    bytes: Uint8Array,
    opts?: { readonly overwrite?: boolean },
  ): Promise<Result<void, FsError>>;
  /** True if an output already exists. Used for skip/number/overwrite collision strategies. */
  outputExists(name: string): Promise<Result<boolean, FsError>>;
}

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

export const looksLikeImage = (name: string): boolean => {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

export const mimeFor = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
};

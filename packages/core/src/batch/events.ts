import type { ComfyError, ImageRef } from '../comfy/types.js';
import type { FsError } from '../fs/types.js';
import type { PatchError } from '../workflow/patcher.js';

export type RunFailureReason =
  | { readonly kind: 'fs'; readonly error: FsError }
  | { readonly kind: 'patch'; readonly error: PatchError }
  | { readonly kind: 'comfy'; readonly error: ComfyError }
  | { readonly kind: 'no_output' }
  | { readonly kind: 'aborted' };

export interface BatchItem {
  readonly id: string;
  readonly input: string;
}

export type BatchEvent =
  | { readonly type: 'batch_started'; readonly total: number; readonly correlationId: string }
  | { readonly type: 'item_queued'; readonly item: BatchItem; readonly index: number }
  | { readonly type: 'item_started'; readonly item: BatchItem; readonly promptId: string }
  | {
      readonly type: 'item_progress';
      readonly item: BatchItem;
      readonly value: number;
      readonly max: number;
      readonly node: string | null;
    }
  | {
      readonly type: 'item_completed';
      readonly item: BatchItem;
      readonly outputName: string;
      readonly outputBytes: number;
      readonly source: ImageRef;
      readonly elapsedMs: number;
    }
  | { readonly type: 'item_skipped'; readonly item: BatchItem; readonly reason: 'output_exists' }
  | { readonly type: 'item_failed'; readonly item: BatchItem; readonly reason: RunFailureReason }
  | { readonly type: 'batch_completed'; readonly summary: BatchSummary };

export interface BatchSummary {
  readonly correlationId: string;
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failures: readonly { readonly item: BatchItem; readonly reason: RunFailureReason }[];
  readonly elapsedMs: number;
}

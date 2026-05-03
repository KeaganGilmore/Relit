import type { ComfyClient } from '../comfy/client.js';
import type { ComfyError, HistoryEntry, ImageRef, WsMessage } from '../comfy/types.js';
import type { ComfyWsClient } from '../comfy/ws.js';
import type { FileSystem } from '../fs/types.js';
import { mimeFor } from '../fs/types.js';
import { planOutputName, type CollisionStrategy } from '../output-namer.js';
import type { Params, WorkflowDefinition } from '../workflow/definition.js';
import { patch } from '../workflow/patcher.js';
import type { BatchEvent, BatchItem, BatchSummary, RunFailureReason } from './events.js';

export interface BatchOptions {
  readonly definition: WorkflowDefinition;
  readonly params?: Params;
  /** Input filenames to process. Order is preserved for queue events. */
  readonly inputs: readonly string[];
  readonly outputSuffix?: string;
  readonly outputExtension?: string;
  readonly collision?: CollisionStrategy;
  /**
   * Maximum number of items in flight at once. Default 1 (sequential).
   * ComfyUI queues prompts internally regardless, but raising this lets
   * upload/download/wait phases overlap.
   */
  readonly concurrency?: number;
  /** Subfolder under ComfyUI's input dir to upload to. Defaults to a unique batch id. */
  readonly uploadSubfolder?: string;
  /** Per-item timeout for the prompt to complete on the server. Default 5 minutes. */
  readonly itemTimeoutMs?: number;
  /** History poll interval. Default 1s. */
  readonly pollIntervalMs?: number;
  readonly correlationId?: string;
  readonly signal?: AbortSignal;
}

export interface BatchRunnerDeps {
  readonly comfy: ComfyClient;
  readonly fs: FileSystem;
  /** Optional WS client. If absent, runner falls back to history polling only. */
  readonly ws?: ComfyWsClient;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly sleep?: (ms: number) => Promise<void>;
}

type Listener = (event: BatchEvent) => void;

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

export class BatchRunner {
  private readonly listeners = new Set<Listener>();
  private readonly comfy: ComfyClient;
  private readonly fs: FileSystem;
  private readonly ws: ComfyWsClient | undefined;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: BatchRunnerDeps) {
    this.comfy = deps.comfy;
    this.fs = deps.fs;
    this.ws = deps.ws;
    this.now = deps.now ?? (() => Date.now());
    this.randomId = deps.randomId ?? defaultRandomId;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async run(options: BatchOptions): Promise<BatchSummary> {
    const correlationId = options.correlationId ?? `batch-${this.randomId()}`;
    const subfolder = options.uploadSubfolder ?? `relit/${correlationId}`;
    const total = options.inputs.length;
    const startedAt = this.now();
    const failures: { item: BatchItem; reason: RunFailureReason }[] = [];
    let succeeded = 0;
    let skipped = 0;
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));

    this.emit({ type: 'batch_started', total, correlationId });

    // ---- Phase 1: pre-plan output names sequentially.
    // This guarantees concurrent items don't race on the same target name.
    type Plan =
      | { kind: 'run'; item: BatchItem; outputName: string }
      | { kind: 'skip'; item: BatchItem }
      | { kind: 'fail'; item: BatchItem; reason: RunFailureReason };

    const plans: Plan[] = [];
    const claimed = new Set<string>();

    for (let index = 0; index < options.inputs.length; index++) {
      const input = options.inputs[index]!;
      const item: BatchItem = { id: `${correlationId}/${index}`, input };
      this.emit({ type: 'item_queued', item, index });

      if (options.signal?.aborted) {
        plans.push({ kind: 'fail', item, reason: { kind: 'aborted' } });
        continue;
      }

      const namePlan = await this.planName(input, options, claimed);
      if (namePlan.outcome === 'failed') {
        plans.push({ kind: 'fail', item, reason: namePlan.reason });
      } else if (namePlan.outcome === 'skipped') {
        plans.push({ kind: 'skip', item });
      } else {
        claimed.add(namePlan.name);
        plans.push({ kind: 'run', item, outputName: namePlan.name });
      }
    }

    // ---- Phase 2: fan out the actual processing with bounded concurrency.
    type SettledOutcome =
      | { kind: 'completed'; item: BatchItem; result: RunOneCompleted }
      | { kind: 'skipped'; item: BatchItem }
      | { kind: 'failed'; item: BatchItem; reason: RunFailureReason };

    const finalize = (outcome: SettledOutcome): void => {
      switch (outcome.kind) {
        case 'completed':
          succeeded += 1;
          this.emit({
            type: 'item_completed',
            item: outcome.item,
            outputName: outcome.result.outputName,
            outputBytes: outcome.result.outputBytes,
            source: outcome.result.source,
            elapsedMs: outcome.result.elapsedMs,
          });
          break;
        case 'skipped':
          skipped += 1;
          this.emit({ type: 'item_skipped', item: outcome.item, reason: 'output_exists' });
          break;
        case 'failed':
          failures.push({ item: outcome.item, reason: outcome.reason });
          this.emit({ type: 'item_failed', item: outcome.item, reason: outcome.reason });
          break;
      }
    };

    const inFlight = new Set<Promise<SettledOutcome>>();

    const launch = (plan: Plan): Promise<SettledOutcome> | undefined => {
      if (plan.kind === 'skip') {
        return Promise.resolve({ kind: 'skipped', item: plan.item });
      }
      if (plan.kind === 'fail') {
        return Promise.resolve({ kind: 'failed', item: plan.item, reason: plan.reason });
      }
      if (options.signal?.aborted) {
        return Promise.resolve({ kind: 'failed', item: plan.item, reason: { kind: 'aborted' } });
      }
      return this.processItem(plan.item, plan.outputName, options, subfolder).then(
        (r): SettledOutcome =>
          r.outcome === 'completed'
            ? { kind: 'completed', item: plan.item, result: r }
            : { kind: 'failed', item: plan.item, reason: r.reason },
      );
    };

    for (const plan of plans) {
      while (inFlight.size >= concurrency) {
        finalize(await Promise.race(inFlight));
      }
      const promise = launch(plan);
      if (!promise) continue;
      const tracked: Promise<SettledOutcome> = promise.finally(() => {
        inFlight.delete(tracked);
      }) as Promise<SettledOutcome>;
      inFlight.add(tracked);
    }

    while (inFlight.size > 0) {
      finalize(await Promise.race(inFlight));
    }

    const summary: BatchSummary = {
      correlationId,
      total,
      succeeded,
      failed: failures.length,
      skipped,
      failures,
      elapsedMs: this.now() - startedAt,
    };
    this.emit({ type: 'batch_completed', summary });
    return summary;
  }

  private async processItem(
    item: BatchItem,
    outputName: string,
    options: BatchOptions,
    subfolder: string,
  ): Promise<RunOneResult> {
    const t0 = this.now();
    const collision = options.collision ?? 'number';

    // 1. Read source bytes.
    const bytesR = await this.fs.readInput(item.input);
    if (!bytesR.ok) return { outcome: 'failed', reason: { kind: 'fs', error: bytesR.error } };

    // 2. Upload to ComfyUI input dir.
    const upload = await this.comfy.uploadImage(
      { data: bytesR.value, filename: item.input, mime: mimeFor(item.input) },
      { type: 'input', subfolder, overwrite: true },
    );
    if (!upload.ok) return { outcome: 'failed', reason: { kind: 'comfy', error: upload.error } };
    const uploadedName = upload.value.subfolder
      ? `${upload.value.subfolder}/${upload.value.name}`
      : upload.value.name;

    // 3. Patch workflow graph.
    const graph = patch(options.definition, {
      inputImage: uploadedName,
      outputPrefix: `relit/${item.id}`,
      ...(options.params ? { params: options.params } : {}),
    });
    if (!graph.ok) return { outcome: 'failed', reason: { kind: 'patch', error: graph.error } };

    // 4. Submit prompt.
    const submitted = await this.comfy.submitPrompt(graph.value);
    if (!submitted.ok) {
      return { outcome: 'failed', reason: { kind: 'comfy', error: submitted.error } };
    }
    const promptId = submitted.value.prompt_id;
    this.emit({ type: 'item_started', item, promptId });

    // 5. Wait for completion.
    const wait = await this.waitForCompletion(item, promptId, options);
    if (wait.outcome !== 'ok') return { outcome: 'failed', reason: wait.reason };

    // 6. Pick output, download, write.
    const source = pickFirstImage(wait.entry);
    if (!source) return { outcome: 'failed', reason: { kind: 'no_output' } };

    const dl = await this.comfy.downloadImage(source);
    if (!dl.ok) return { outcome: 'failed', reason: { kind: 'comfy', error: dl.error } };

    const w = await this.fs.writeOutput(outputName, dl.value, {
      overwrite: collision === 'overwrite',
    });
    if (!w.ok) return { outcome: 'failed', reason: { kind: 'fs', error: w.error } };

    return {
      outcome: 'completed',
      outputName,
      outputBytes: dl.value.byteLength,
      source,
      elapsedMs: this.now() - t0,
    };
  }

  private async planName(
    input: string,
    options: BatchOptions,
    claimed: ReadonlySet<string>,
  ): Promise<
    | { outcome: 'ok'; name: string }
    | { outcome: 'skipped' }
    | { outcome: 'failed'; reason: RunFailureReason }
  > {
    const collision = options.collision ?? 'number';

    const candidates: string[] = [];
    candidates.push(applyAll(input, options.outputSuffix, options.outputExtension));
    if (collision === 'number') {
      for (let i = 1; i < 100; i++) {
        candidates.push(applyAllNumbered(input, options.outputSuffix, options.outputExtension, i));
      }
    }
    const existence: Record<string, boolean> = {};
    for (const c of candidates) {
      // A name claimed by an earlier item this batch counts as "exists" for planning.
      if (claimed.has(c)) {
        existence[c] = true;
        continue;
      }
      const r = await this.fs.outputExists(c);
      if (!r.ok) return { outcome: 'failed', reason: { kind: 'fs', error: r.error } };
      existence[c] = r.value;
      if (collision !== 'number' && c === candidates[0]) break;
      if (collision === 'number' && !r.value) break;
    }

    const decision = planOutputName(
      input,
      {
        ...(options.outputSuffix !== undefined ? { suffix: options.outputSuffix } : {}),
        ...(options.outputExtension !== undefined ? { extension: options.outputExtension } : {}),
        collision,
      },
      (name) => existence[name] ?? false,
    );
    if (decision.action === 'skip') return { outcome: 'skipped' };
    return { outcome: 'ok', name: decision.name };
  }

  private async waitForCompletion(
    item: BatchItem,
    promptId: string,
    options: BatchOptions,
  ): Promise<
    { outcome: 'ok'; entry: HistoryEntry } | { outcome: 'failed'; reason: RunFailureReason }
  > {
    const timeoutMs = options.itemTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = this.now() + timeoutMs;

    const wsUnsubs: (() => void)[] = [];
    if (this.ws) {
      wsUnsubs.push(
        this.ws.onMessage((m: WsMessage) => {
          if (m.type !== 'progress') return;
          const data = m.data as {
            value?: number;
            max?: number;
            node?: string;
            prompt_id?: string;
          };
          if (data.prompt_id !== promptId) return;
          this.emit({
            type: 'item_progress',
            item,
            value: data.value ?? 0,
            max: data.max ?? 1,
            node: data.node ?? null,
          });
        }),
      );
    }

    try {
      while (this.now() < deadline) {
        if (options.signal?.aborted) return { outcome: 'failed', reason: { kind: 'aborted' } };

        const r = await this.comfy.historyEntry(promptId);
        if (!r.ok) return { outcome: 'failed', reason: { kind: 'comfy', error: r.error } };
        if (r.value && r.value.status.completed) {
          if (r.value.status.status_str === 'error') {
            const errMsg = findExecutionError(r.value);
            const comfyError: ComfyError = errMsg
              ? { kind: 'execution', payload: errMsg }
              : { kind: 'http', status: 0, body: 'unknown execution failure' };
            return { outcome: 'failed', reason: { kind: 'comfy', error: comfyError } };
          }
          return { outcome: 'ok', entry: r.value };
        }
        await this.sleep(pollIntervalMs);
      }
      return {
        outcome: 'failed',
        reason: {
          kind: 'comfy',
          error: { kind: 'timeout', message: `prompt ${promptId} timed out`, elapsedMs: timeoutMs },
        },
      };
    } finally {
      for (const u of wsUnsubs) u();
    }
  }

  private emit(event: BatchEvent): void {
    for (const l of this.listeners) l(event);
  }
}

type RunOneCompleted = {
  outcome: 'completed';
  outputName: string;
  outputBytes: number;
  source: ImageRef;
  elapsedMs: number;
};

type RunOneResult =
  | RunOneCompleted
  | { outcome: 'failed'; reason: RunFailureReason };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

const defaultRandomId = (): string =>
  typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const splitExt = (name: string): { stem: string; ext: string } => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
};

const applyAll = (name: string, suffix: string | undefined, ext: string | undefined): string => {
  const { stem, ext: origExt } = splitExt(name);
  return `${stem}${suffix ?? ''}${ext ?? origExt}`;
};

const applyAllNumbered = (
  name: string,
  suffix: string | undefined,
  ext: string | undefined,
  n: number,
): string => {
  const { stem, ext: origExt } = splitExt(name);
  return `${stem}${suffix ?? ''} (${n})${ext ?? origExt}`;
};

const pickFirstImage = (entry: HistoryEntry): ImageRef | undefined => {
  for (const out of Object.values(entry.outputs)) {
    if (out.images && out.images.length > 0) return out.images[0];
  }
  return undefined;
};

const findExecutionError = (entry: HistoryEntry) => {
  for (const [type, payload] of entry.status.messages) {
    if (type === 'execution_error') {
      return payload as {
        prompt_id: string;
        node_id: string;
        node_type: string;
        executed: readonly string[];
        exception_message: string;
        exception_type: string;
        traceback: readonly string[];
      };
    }
  }
  return undefined;
};

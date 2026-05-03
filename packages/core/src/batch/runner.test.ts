import { describe, expect, it, vi } from 'vitest';
import { ComfyClient } from '../comfy/client.js';
import type { FileSystem, FsEntry } from '../fs/types.js';
import { ok, err } from '../result.js';
import { passthroughWorkflow } from '../workflows/passthrough.js';
import { BatchRunner } from './runner.js';
import type { BatchEvent } from './events.js';

const makeFakeFs = (
  initialInputs: Record<string, Uint8Array> = {},
  initialOutputs: Set<string> = new Set(),
): FileSystem & { writes: { name: string; bytes: Uint8Array }[] } => {
  const writes: { name: string; bytes: Uint8Array }[] = [];
  return {
    writes,
    async listInputs() {
      return ok(Object.keys(initialInputs).map<FsEntry>((name) => ({ name })));
    },
    async readInput(name) {
      const b = initialInputs[name];
      return b ? ok(b) : err({ kind: 'not_found', path: name });
    },
    async writeOutput(name, bytes) {
      writes.push({ name, bytes });
      initialOutputs.add(name);
      return ok(undefined);
    },
    async outputExists(name) {
      return ok(initialOutputs.has(name));
    },
  };
};

const fakeFetchSequence = (responses: Array<(url: string, init?: RequestInit) => Response>) => {
  let i = 0;
  return vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const handler = responses[i++];
    if (!handler) throw new Error(`Unexpected fetch ${i}: ${url}`);
    return handler(url, init);
  });
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('BatchRunner', () => {
  it('runs a single image end to end and emits the expected event sequence', async () => {
    const fs = makeFakeFs({ 'photo.jpg': new Uint8Array([1, 2, 3]) });

    const fetchFn = fakeFetchSequence([
      // 1. uploadImage
      () => json({ name: 'photo.jpg', subfolder: 'relit/cid', type: 'input' }),
      // 2. submitPrompt
      () => json({ prompt_id: 'pid-1', number: 1, node_errors: {} }),
      // 3. historyEntry → completed
      () =>
        json({
          'pid-1': {
            prompt: [1, 'pid-1', {}, {}, []],
            outputs: {
              '2': {
                images: [{ filename: 'relit_pid_00001_.png', subfolder: '', type: 'output' }],
              },
            },
            status: {
              status_str: 'success',
              completed: true,
              messages: [['execution_success', { prompt_id: 'pid-1', timestamp: 0 }]],
            },
          },
        }),
      // 4. downloadImage
      () => new Response(new Uint8Array([9, 9, 9]), { status: 200 }),
    ]);

    const comfy = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      fetch: fetchFn,
      clientId: 'cid',
    });
    const runner = new BatchRunner({
      comfy,
      fs,
      now: () => 0,
      randomId: () => 'cid',
      sleep: () => Promise.resolve(),
    });
    const events: BatchEvent[] = [];
    runner.on((e) => events.push(e));

    const summary = await runner.run({
      definition: passthroughWorkflow,
      inputs: ['photo.jpg'],
      outputSuffix: '_relit',
    });

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0]?.name).toBe('photo_relit.jpg');
    expect(fs.writes[0]?.bytes).toEqual(new Uint8Array([9, 9, 9]));

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'batch_started',
      'item_queued',
      'item_started',
      'item_completed',
      'batch_completed',
    ]);
  });

  it('skip strategy short-circuits before any HTTP traffic', async () => {
    const fs = makeFakeFs({ 'photo.jpg': new Uint8Array([1]) }, new Set(['photo_relit.jpg']));
    const fetchFn = vi.fn();
    const comfy = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      fetch: fetchFn,
      clientId: 'cid',
    });
    const runner = new BatchRunner({
      comfy,
      fs,
      now: () => 0,
      randomId: () => 'cid',
      sleep: () => Promise.resolve(),
    });

    const events: BatchEvent[] = [];
    runner.on((e) => events.push(e));

    const summary = await runner.run({
      definition: passthroughWorkflow,
      inputs: ['photo.jpg'],
      outputSuffix: '_relit',
      collision: 'skip',
    });

    expect(summary.skipped).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual([
      'batch_started',
      'item_queued',
      'item_skipped',
      'batch_completed',
    ]);
  });

  it('number strategy picks the next free slot when (1) is also taken', async () => {
    const fs = makeFakeFs(
      { 'photo.jpg': new Uint8Array([1]) },
      new Set(['photo_relit.jpg', 'photo_relit (1).jpg']),
    );

    const fetchFn = fakeFetchSequence([
      () => json({ name: 'photo.jpg', subfolder: 'relit/cid', type: 'input' }),
      () => json({ prompt_id: 'p', number: 1, node_errors: {} }),
      () =>
        json({
          p: {
            prompt: [1, 'p', {}, {}, []],
            outputs: { '2': { images: [{ filename: 'r.png', subfolder: '', type: 'output' }] } },
            status: { status_str: 'success', completed: true, messages: [] },
          },
        }),
      () => new Response(new Uint8Array([0xff]), { status: 200 }),
    ]);

    const comfy = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      fetch: fetchFn,
      clientId: 'cid',
    });
    const runner = new BatchRunner({
      comfy,
      fs,
      now: () => 0,
      randomId: () => 'cid',
      sleep: () => Promise.resolve(),
    });
    const summary = await runner.run({
      definition: passthroughWorkflow,
      inputs: ['photo.jpg'],
      outputSuffix: '_relit',
      collision: 'number',
    });

    expect(summary.succeeded).toBe(1);
    expect(fs.writes[0]?.name).toBe('photo_relit (2).jpg');
  });

  it('reports execution_error from history as a comfy/execution failure', async () => {
    const fs = makeFakeFs({ 'photo.jpg': new Uint8Array([1]) });
    const fetchFn = fakeFetchSequence([
      () => json({ name: 'photo.jpg', subfolder: '', type: 'input' }),
      () => json({ prompt_id: 'p', number: 1, node_errors: {} }),
      () =>
        json({
          p: {
            prompt: [1, 'p', {}, {}, []],
            outputs: {},
            status: {
              status_str: 'error',
              completed: true,
              messages: [
                [
                  'execution_error',
                  {
                    prompt_id: 'p',
                    node_id: '1',
                    node_type: 'LoadImage',
                    executed: [],
                    exception_message: 'oh no',
                    exception_type: 'RuntimeError',
                    traceback: [],
                  },
                ],
              ],
            },
          },
        }),
    ]);

    const comfy = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      fetch: fetchFn,
      clientId: 'cid',
    });
    const runner = new BatchRunner({
      comfy,
      fs,
      now: () => 0,
      randomId: () => 'cid',
      sleep: () => Promise.resolve(),
    });
    const events: BatchEvent[] = [];
    runner.on((e) => events.push(e));

    const summary = await runner.run({
      definition: passthroughWorkflow,
      inputs: ['photo.jpg'],
    });

    expect(summary.failed).toBe(1);
    const failed = events.find((e) => e.type === 'item_failed');
    expect(failed && failed.type === 'item_failed' && failed.reason.kind).toBe('comfy');
    if (failed && failed.type === 'item_failed' && failed.reason.kind === 'comfy') {
      expect(failed.reason.error.kind).toBe('execution');
      if (failed.reason.error.kind === 'execution') {
        expect(failed.reason.error.payload.exception_message).toBe('oh no');
      }
    }
  });

  it('aborts via signal between items', async () => {
    const fs = makeFakeFs({ 'a.jpg': new Uint8Array([1]), 'b.jpg': new Uint8Array([2]) });
    const fetchFn = fakeFetchSequence([
      () => json({ name: 'a.jpg', subfolder: '', type: 'input' }),
      () => json({ prompt_id: 'p1', number: 1, node_errors: {} }),
      () =>
        json({
          p1: {
            prompt: [1, 'p1', {}, {}, []],
            outputs: { '2': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } },
            status: { status_str: 'success', completed: true, messages: [] },
          },
        }),
      () => new Response(new Uint8Array([0]), { status: 200 }),
    ]);

    const comfy = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      fetch: fetchFn,
      clientId: 'cid',
    });
    const runner = new BatchRunner({
      comfy,
      fs,
      now: () => 0,
      randomId: () => 'cid',
      sleep: () => Promise.resolve(),
    });
    const ctl = new AbortController();
    let firstCompleted = false;
    runner.on((e) => {
      if (e.type === 'item_completed' && !firstCompleted) {
        firstCompleted = true;
        ctl.abort();
      }
    });

    const summary = await runner.run({
      definition: passthroughWorkflow,
      inputs: ['a.jpg', 'b.jpg'],
      signal: ctl.signal,
    });

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]?.reason.kind).toBe('aborted');
  });

  it('times out a stuck prompt', async () => {
    const fs = makeFakeFs({ 'photo.jpg': new Uint8Array([1]) });
    const responses = [
      () => json({ name: 'photo.jpg', subfolder: '', type: 'input' }),
      () => json({ prompt_id: 'p', number: 1, node_errors: {} }),
    ];
    let nowValue = 0;
    const fetchFn = vi.fn(async (input: Request | string | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (responses.length > 0) return responses.shift()!(url);
      // history endpoint always returns "not yet completed"
      return json({});
    });

    const comfy = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      fetch: fetchFn,
      clientId: 'cid',
    });
    const runner = new BatchRunner({
      comfy,
      fs,
      now: () => {
        nowValue += 1000;
        return nowValue;
      },
      randomId: () => 'cid',
      sleep: () => Promise.resolve(),
    });

    const summary = await runner.run({
      definition: passthroughWorkflow,
      inputs: ['photo.jpg'],
      itemTimeoutMs: 5_000,
    });

    expect(summary.failed).toBe(1);
    const reason = summary.failures[0]?.reason;
    expect(reason?.kind).toBe('comfy');
    if (reason?.kind === 'comfy') expect(reason.error.kind).toBe('timeout');
  });
});

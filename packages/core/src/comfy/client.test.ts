import { describe, expect, it, vi } from 'vitest';
import { ComfyClient } from './client.js';
import type { HistoryResponse, PromptResponse, UploadImageResponse } from './types.js';

const makeFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  });

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ComfyClient', () => {
  it('strips trailing slash from baseUrl and generates a clientId', () => {
    const c = new ComfyClient({
      baseUrl: 'http://localhost:8188/',
      fetch: makeFetch(() => json({})),
    });
    expect(c.baseUrl).toBe('http://localhost:8188');
    expect(c.clientId).toMatch(/^relit-/);
  });

  it('uploadImage posts multipart form and parses response', async () => {
    const fetchFn = makeFetch((url, init) => {
      expect(url).toBe('http://localhost:8188/upload/image');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
      return json<UploadImageResponse>({ name: 'tiny.png', subfolder: '', type: 'input' });
    });
    const c = new ComfyClient({ baseUrl: 'http://localhost:8188', fetch: fetchFn });
    const r = await c.uploadImage({
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      filename: 'tiny.png',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe('tiny.png');
  });

  it('submitPrompt parses success response', async () => {
    const fetchFn = makeFetch(() =>
      json<PromptResponse>({ prompt_id: 'abc', number: 1, node_errors: {} }),
    );
    const c = new ComfyClient({ baseUrl: 'http://localhost:8188', fetch: fetchFn });
    const r = await c.submitPrompt({
      '1': { class_type: 'LoadImage', inputs: { image: 'x.png' } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.prompt_id).toBe('abc');
  });

  it('submitPrompt maps 400 with node_errors to validation error', async () => {
    const fetchFn = makeFetch(() =>
      json(
        {
          error: {
            type: 'prompt_outputs_failed_validation',
            message: 'bad',
            details: '',
            extra_info: {},
          },
          node_errors: {
            '1': {
              errors: [{ type: 'x', message: 'y', details: '', extra_info: {} }],
              dependent_outputs: ['2'],
              class_type: 'LoadImage',
            },
          },
        },
        400,
      ),
    );
    const c = new ComfyClient({ baseUrl: 'http://localhost:8188', fetch: fetchFn });
    const r = await c.submitPrompt({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      if (r.error.kind === 'validation') {
        expect(r.error.nodeErrors['1']?.errors[0]?.message).toBe('y');
      }
    }
  });

  it('submitPrompt falls through to http error when 400 body is non-validation', async () => {
    const fetchFn = makeFetch(() => new Response('something else', { status: 400 }));
    const c = new ComfyClient({ baseUrl: 'http://localhost:8188', fetch: fetchFn });
    const r = await c.submitPrompt({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('http');
  });

  it('history(promptId) returns null when prompt is not in the response', async () => {
    const fetchFn = makeFetch(() => json<HistoryResponse>({}));
    const c = new ComfyClient({ baseUrl: 'http://localhost:8188', fetch: fetchFn });
    const r = await c.historyEntry('missing');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('history(promptId) returns the entry when present', async () => {
    const entry = {
      prompt: [1, 'pid', {}, {}, []] as const,
      outputs: { '2': { images: [{ filename: 'a.png', subfolder: '', type: 'output' as const }] } },
      status: { status_str: 'success' as const, completed: true, messages: [] },
    };
    const fetchFn = makeFetch(() => json<HistoryResponse>({ pid: entry }));
    const c = new ComfyClient({ baseUrl: 'http://localhost:8188', fetch: fetchFn });
    const r = await c.historyEntry('pid');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value?.status.status_str).toBe('success');
  });

  it('viewUrl encodes query params', () => {
    const c = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      fetch: makeFetch(() => json({})),
    });
    const url = c.viewUrl({ filename: 'a b.png', subfolder: 'sub dir', type: 'output' });
    expect(url).toContain('filename=a+b.png');
    expect(url).toContain('subfolder=sub+dir');
    expect(url).toContain('type=output');
  });

  it('wsUrl swaps http→ws and embeds clientId', () => {
    const c = new ComfyClient({
      baseUrl: 'http://localhost:8188',
      clientId: 'cid',
      fetch: makeFetch(() => json({})),
    });
    expect(c.wsUrl()).toBe('ws://localhost:8188/ws?clientId=cid');
  });

  it('wsUrl handles https→wss', () => {
    const c = new ComfyClient({
      baseUrl: 'https://comfy.example/',
      clientId: 'cid',
      fetch: makeFetch(() => json({})),
    });
    expect(c.wsUrl()).toBe('wss://comfy.example/ws?clientId=cid');
  });

  it('downloadImage returns bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchFn = makeFetch(() => new Response(bytes, { status: 200 }));
    const c = new ComfyClient({ baseUrl: 'http://localhost:8188', fetch: fetchFn });
    const r = await c.downloadImage({ filename: 'a.png', subfolder: '', type: 'output' });
    expect(r.ok).toBe(true);
    if (r.ok) expect([...r.value]).toEqual([1, 2, 3, 4]);
  });

  it('maps fetch throws to network error', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('econnrefused');
    });
    const c = new ComfyClient({ baseUrl: 'http://localhost:8188', fetch: fetchFn });
    const r = await c.systemStats();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('network');
      if (r.error.kind === 'network') expect(r.error.message).toContain('econnrefused');
    }
  });
});

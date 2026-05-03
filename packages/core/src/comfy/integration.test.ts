import { describe, expect, it } from 'vitest';
import { ComfyClient } from './client.js';

const live = process.env['RELIT_LIVE'] === '1';
const baseUrl = process.env['RELIT_COMFY_URL'] ?? 'http://localhost:8188';
const describeLive = live ? describe : describe.skip;

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const decodeBase64 = (b64: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

describeLive(`ComfyClient against live ComfyUI at ${baseUrl}`, () => {
  const client = new ComfyClient({ baseUrl });

  it('systemStats returns version', async () => {
    const r = await client.systemStats();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.system.comfyui_version).toMatch(/\d+\.\d+/);
      expect(r.value.devices.length).toBeGreaterThan(0);
    }
  });

  it('round-trips a tiny image through LoadImage → SaveImage', async () => {
    const png = decodeBase64(TINY_PNG_BASE64);
    const upload = await client.uploadImage(
      { data: png, filename: `relit-it-${Date.now()}.png`, mime: 'image/png' },
      { type: 'input', overwrite: true },
    );
    expect(upload.ok).toBe(true);
    if (!upload.ok) return;

    const submit = await client.submitPrompt({
      '1': { class_type: 'LoadImage', inputs: { image: upload.value.name } },
      '2': {
        class_type: 'SaveImage',
        inputs: { images: ['1', 0], filename_prefix: 'relit-it' },
      },
    });
    expect(submit.ok).toBe(true);
    if (!submit.ok) return;

    const promptId = submit.value.prompt_id;
    const deadline = Date.now() + 30_000;
    let entry: Awaited<ReturnType<typeof client.historyEntry>> | null = null;
    while (Date.now() < deadline) {
      const r = await client.historyEntry(promptId);
      if (r.ok && r.value && r.value.status.completed) {
        entry = r;
        break;
      }
      await new Promise((res) => globalThis.setTimeout(res, 250));
    }
    expect(entry?.ok).toBe(true);
    if (entry?.ok && entry.value) {
      expect(entry.value.status.status_str).toBe('success');
      const outImages = entry.value.outputs['2']?.images ?? [];
      expect(outImages.length).toBeGreaterThan(0);
      const first = outImages[0]!;
      const dl = await client.downloadImage(first);
      expect(dl.ok).toBe(true);
      if (dl.ok) expect(dl.value.byteLength).toBeGreaterThan(0);
    }
  }, 60_000);
});

import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition } from './definition.js';
import { patch } from './patcher.js';

const sampleDef: WorkflowDefinition = {
  id: 'sample',
  displayName: 'Sample',
  graph: {
    '1': { class_type: 'LoadImage', inputs: { image: '__INPUT__' } },
    '2': {
      class_type: 'KSampler',
      inputs: { seed: 0, steps: 20, cfg: 7.5, denoise: 1.0, latent_image: ['1', 0] },
    },
    '3': {
      class_type: 'SaveImage',
      inputs: { images: ['2', 0], filename_prefix: '__OUTPUT__' },
    },
  },
  input: { node: '1', input: 'image' },
  output: { node: '3', input: 'filename_prefix' },
  params: {
    seed: { kind: 'seed', default: 0, target: { node: '2', input: 'seed' } },
    steps: { kind: 'integer', default: 20, target: { node: '2', input: 'steps' } },
    denoise: { kind: 'number', default: 1.0, target: { node: '2', input: 'denoise' } },
  },
};

describe('patch', () => {
  it('writes input filename and output prefix into the graph', () => {
    const r = patch(sampleDef, { inputImage: 'photo.jpg', outputPrefix: 'relit' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value['1']!.inputs['image']).toBe('photo.jpg');
      expect(r.value['3']!.inputs['filename_prefix']).toBe('relit');
    }
  });

  it('does not mutate the original graph', () => {
    patch(sampleDef, { inputImage: 'photo.jpg', outputPrefix: 'relit' });
    expect(sampleDef.graph['1']!.inputs['image']).toBe('__INPUT__');
    expect(sampleDef.graph['3']!.inputs['filename_prefix']).toBe('__OUTPUT__');
  });

  it('applies provided params to their bound inputs', () => {
    const r = patch(sampleDef, {
      inputImage: 'p.jpg',
      outputPrefix: 'r',
      params: { seed: 42, steps: 30 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value['2']!.inputs['seed']).toBe(42);
      expect(r.value['2']!.inputs['steps']).toBe(30);
      expect(r.value['2']!.inputs['denoise']).toBe(1.0);
    }
  });

  it('rejects unknown params', () => {
    const r = patch(sampleDef, {
      inputImage: 'p.jpg',
      outputPrefix: 'r',
      params: { bogus: 1 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('unknown_param');
      if (r.error.kind === 'unknown_param') expect(r.error.param).toBe('bogus');
    }
  });

  it('rejects bindings to non-existent nodes', () => {
    const broken: WorkflowDefinition = {
      ...sampleDef,
      input: { node: '99', input: 'image' },
    };
    const r = patch(broken, { inputImage: 'p.jpg', outputPrefix: 'r' });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'unknown_node') expect(r.error.node).toBe('99');
  });

  it('rejects bindings to non-existent inputs', () => {
    const broken: WorkflowDefinition = {
      ...sampleDef,
      input: { node: '1', input: 'not_a_field' },
    };
    const r = patch(broken, { inputImage: 'p.jpg', outputPrefix: 'r' });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'unknown_input') {
      expect(r.error.node).toBe('1');
      expect(r.error.input).toBe('not_a_field');
    }
  });
});

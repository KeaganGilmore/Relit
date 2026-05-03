import { describe, expect, it } from 'vitest';
import { defaultParams } from '../workflow/definition.js';
import { patch } from '../workflow/patcher.js';
import { builtInWorkflows } from './index.js';

describe('built-in WorkflowDefinitions', () => {
  it.each(builtInWorkflows.map((w) => [w.id, w] as const))(
    '%s definition validates: input/output bindings exist and patcher accepts default params',
    (_id, def) => {
      const r = patch(def, {
        inputImage: 'fixture.png',
        outputPrefix: 'out',
        params: defaultParams(def),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // Input binding wrote to the right place.
      expect(r.value[def.input.node]?.inputs[def.input.input]).toBe('fixture.png');
      // Output binding wrote to the right place.
      expect(r.value[def.output.node]?.inputs[def.output.input]).toBe('out');

      // All param targets refer to existing nodes/inputs in the graph.
      for (const [key, spec] of Object.entries(def.params)) {
        const target = def.graph[spec.target.node];
        expect(target, `param ${key} references missing node ${spec.target.node}`).toBeDefined();
        expect(
          target?.inputs[spec.target.input],
          `param ${key} references missing input ${spec.target.node}.${spec.target.input}`,
        ).toBeDefined();
      }
    },
  );

  it('iclight and qwen-image-edit cover the abstraction surface — no extra ParamSpec kinds needed', () => {
    const kinds = new Set<string>();
    for (const w of builtInWorkflows) {
      for (const p of Object.values(w.params)) kinds.add(p.kind);
    }
    // If a new workflow needs a param kind not in this set, the abstraction
    // probably needs to grow — and that change should be deliberate.
    expect([...kinds].sort()).toEqual(['integer', 'number', 'seed', 'string']);
  });
});

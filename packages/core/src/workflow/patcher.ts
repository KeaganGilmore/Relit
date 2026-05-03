import { err, ok, type Result } from '../result.js';
import type { WorkflowGraph, WorkflowNode } from '../comfy/types.js';
import type { Params, WorkflowDefinition } from './definition.js';

export type PatchError =
  | { readonly kind: 'unknown_node'; readonly node: string }
  | { readonly kind: 'unknown_input'; readonly node: string; readonly input: string }
  | { readonly kind: 'unknown_param'; readonly param: string };

export interface PatchOptions {
  readonly inputImage: string;
  readonly outputPrefix: string;
  readonly params?: Params;
}

const cloneNode = (
  node: WorkflowNode,
): { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } } => ({
  class_type: node.class_type,
  inputs: { ...node.inputs },
  ...(node._meta ? { _meta: { ...node._meta } } : {}),
});

const setInput = (
  graph: Record<string, ReturnType<typeof cloneNode>>,
  binding: { node: string; input: string },
  value: unknown,
): Result<void, PatchError> => {
  const node = graph[binding.node];
  if (!node) return err({ kind: 'unknown_node', node: binding.node });
  if (!(binding.input in node.inputs)) {
    return err({ kind: 'unknown_input', node: binding.node, input: binding.input });
  }
  node.inputs[binding.input] = value;
  return ok(undefined);
};

/**
 * Returns a deep-enough copy of `def.graph` with the input filename, output
 * filename prefix, and any provided params written into their bound nodes.
 *
 * Validates: all bindings must reference existing nodes/inputs; provided
 * params must be declared in the definition.
 */
export const patch = (
  def: WorkflowDefinition,
  options: PatchOptions,
): Result<WorkflowGraph, PatchError> => {
  const cloned: Record<string, ReturnType<typeof cloneNode>> = {};
  for (const [id, node] of Object.entries(def.graph)) cloned[id] = cloneNode(node);

  const i = setInput(cloned, def.input, options.inputImage);
  if (!i.ok) return i;

  const o = setInput(cloned, def.output, options.outputPrefix);
  if (!o.ok) return o;

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      const spec = def.params[key];
      if (!spec) return err({ kind: 'unknown_param', param: key });
      const r = setInput(cloned, spec.target, value);
      if (!r.ok) return r;
    }
  }

  return ok(cloned as WorkflowGraph);
};

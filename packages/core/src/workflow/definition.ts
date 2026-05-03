import type { WorkflowGraph } from '../comfy/types.js';

export type ParamSpec =
  | {
      readonly kind: 'number';
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly label?: string;
    }
  | {
      readonly kind: 'integer';
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly label?: string;
    }
  | {
      readonly kind: 'string';
      readonly default: string;
      readonly multiline?: boolean;
      readonly label?: string;
    }
  | { readonly kind: 'boolean'; readonly default: boolean; readonly label?: string }
  | {
      readonly kind: 'enum';
      readonly default: string;
      readonly options: readonly string[];
      readonly label?: string;
    }
  | {
      readonly kind: 'seed';
      readonly default: number;
      readonly randomize?: boolean;
      readonly label?: string;
    };

export type ParamValue = string | number | boolean;
export type Params = Readonly<Record<string, ParamValue>>;

/**
 * A handle into the workflow graph: which node, which input, optionally which
 * subkey (for nodes with nested input objects). Path is dotted: `nodeId.inputName`.
 */
export interface NodeInputBinding {
  readonly node: string;
  readonly input: string;
}

/**
 * Per-workflow contract. Authored alongside the workflow JSON it points at.
 *
 * The runtime never reads or writes the workflow JSON directly — it goes
 * through `patcher.patch()` which uses these bindings to set the input image
 * filename, output image filename prefix, and any user-tunable params.
 */
export interface WorkflowDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  /** The workflow graph to patch and submit. */
  readonly graph: WorkflowGraph;

  /** Where to plug in the uploaded input filename. */
  readonly input: NodeInputBinding;

  /** Where to set the SaveImage filename_prefix. */
  readonly output: NodeInputBinding;

  /** User-tunable parameters with their target node bindings. */
  readonly params: Readonly<Record<string, ParamSpec & { readonly target: NodeInputBinding }>>;
}

/**
 * Returns the default values for all params declared by the definition.
 * For 'seed' params, the value is randomized when `randomize: true`.
 */
export const defaultParams = (def: WorkflowDefinition): Params => {
  const out: Record<string, ParamValue> = {};
  for (const [key, spec] of Object.entries(def.params)) {
    if (spec.kind === 'seed') {
      out[key] = spec.randomize ? Math.floor(Math.random() * 2 ** 32) : spec.default;
    } else {
      out[key] = spec.default;
    }
  }
  return out;
};

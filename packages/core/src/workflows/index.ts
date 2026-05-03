import type { WorkflowDefinition } from '../workflow/definition.js';
import { iclightWorkflow } from './iclight.js';
import { passthroughWorkflow } from './passthrough.js';
import { qwenImageEditWorkflow } from './qwen-image-edit.js';

export { iclightWorkflow } from './iclight.js';
export { passthroughWorkflow } from './passthrough.js';
export { qwenImageEditWorkflow } from './qwen-image-edit.js';

export const builtInWorkflows: readonly WorkflowDefinition[] = [
  passthroughWorkflow,
  iclightWorkflow,
  qwenImageEditWorkflow,
];

export const findWorkflow = (id: string): WorkflowDefinition | undefined =>
  builtInWorkflows.find((w) => w.id === id);

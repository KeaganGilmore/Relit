import type { WorkflowDefinition } from '../workflow/definition.js';

/**
 * Identity workflow — LoadImage → SaveImage. Useful for smoke-testing the
 * full BatchRunner pipeline against any ComfyUI without depending on
 * relighting custom nodes being installed.
 */
export const passthroughWorkflow: WorkflowDefinition = {
  id: 'passthrough',
  displayName: 'Passthrough (LoadImage → SaveImage)',
  description:
    'Identity workflow used for smoke testing the runner. Output is the input, ' +
    're-encoded by SaveImage. No relighting performed.',
  graph: {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: '__INPUT__' },
      _meta: { title: 'Load input' },
    },
    '2': {
      class_type: 'SaveImage',
      inputs: { images: ['1', 0], filename_prefix: '__OUTPUT__' },
      _meta: { title: 'Save output' },
    },
  },
  input: { node: '1', input: 'image' },
  output: { node: '2', input: 'filename_prefix' },
  params: {},
};

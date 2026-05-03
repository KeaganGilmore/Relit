import type { RunFailureReason } from '@relit/core';

export const formatFailure = (reason: RunFailureReason): string => {
  switch (reason.kind) {
    case 'aborted':
      return 'Aborted.';
    case 'no_output':
      return 'Workflow ran but produced no output image.';
    case 'fs':
      switch (reason.error.kind) {
        case 'not_found':
          return `File not found: ${reason.error.path}`;
        case 'permission':
          return `Permission denied: ${reason.error.message}`;
        case 'exists':
          return `File already exists: ${reason.error.path}`;
        case 'io':
          return `I/O error: ${reason.error.message}`;
      }
      return 'Filesystem error.';
    case 'patch':
      switch (reason.error.kind) {
        case 'unknown_node':
          return `Workflow references unknown node ${reason.error.node}.`;
        case 'unknown_input':
          return `Workflow references unknown input ${reason.error.node}.${reason.error.input}.`;
        case 'unknown_param':
          return `Unknown parameter: ${reason.error.param}.`;
      }
      return 'Patch error.';
    case 'comfy':
      switch (reason.error.kind) {
        case 'network':
          return `ComfyUI network error: ${reason.error.message}`;
        case 'http':
          return `ComfyUI HTTP ${reason.error.status}: ${reason.error.body.slice(0, 240)}`;
        case 'validation': {
          const lines = Object.entries(reason.error.nodeErrors).map(
            ([id, e]) =>
              `node ${id} (${e.class_type}): ${e.errors.map((x) => x.message + ' — ' + x.details).join('; ')}`,
          );
          return `ComfyUI rejected the workflow:\n${lines.join('\n')}`;
        }
        case 'execution':
          return `Node ${reason.error.payload.node_id} (${reason.error.payload.node_type}) raised ${reason.error.payload.exception_type}: ${reason.error.payload.exception_message.trim()}`;
        case 'timeout':
          return `Prompt timed out after ${(reason.error.elapsedMs / 1000).toFixed(0)}s.`;
        case 'aborted':
          return `ComfyUI aborted: ${reason.error.message}`;
      }
      return 'ComfyUI error.';
  }
};

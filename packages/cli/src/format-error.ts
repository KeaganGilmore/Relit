import type { RunFailureReason } from '@relit/core';

export const formatFailure = (reason: RunFailureReason): string => {
  switch (reason.kind) {
    case 'aborted':
      return 'aborted by user';
    case 'no_output':
      return 'workflow ran but produced no output image';
    case 'fs':
      switch (reason.error.kind) {
        case 'not_found':
          return `file not found: ${reason.error.path}`;
        case 'permission':
          return `permission denied: ${reason.error.path}: ${reason.error.message}`;
        case 'exists':
          return `file already exists: ${reason.error.path}`;
        case 'io':
          return `i/o error: ${reason.error.path}: ${reason.error.message}`;
      }
      return 'fs error';
    case 'patch':
      switch (reason.error.kind) {
        case 'unknown_node':
          return `workflow definition references unknown node ${reason.error.node}`;
        case 'unknown_input':
          return `workflow definition references unknown input ${reason.error.node}.${reason.error.input}`;
        case 'unknown_param':
          return `unknown param: ${reason.error.param}`;
      }
      return 'patch error';
    case 'comfy':
      switch (reason.error.kind) {
        case 'network':
          return `comfyui network error: ${reason.error.message}`;
        case 'http':
          return `comfyui http ${reason.error.status}: ${reason.error.body.slice(0, 200)}`;
        case 'validation': {
          const nodes = Object.entries(reason.error.nodeErrors).map(
            ([id, e]) =>
              `  node ${id} (${e.class_type}): ${e.errors.map((x) => x.message + ' — ' + x.details).join('; ')}`,
          );
          return `comfyui rejected the workflow:\n${nodes.join('\n')}`;
        }
        case 'execution':
          return `node ${reason.error.payload.node_id} (${reason.error.payload.node_type}) raised ${reason.error.payload.exception_type}: ${reason.error.payload.exception_message.trim()}`;
        case 'timeout':
          return `comfyui prompt timed out after ${reason.error.elapsedMs}ms`;
        case 'aborted':
          return `comfyui aborted: ${reason.error.message}`;
      }
      return 'comfy error';
  }
};

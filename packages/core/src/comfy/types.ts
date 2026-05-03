export type ImageType = 'input' | 'temp' | 'output';

export interface ImageRef {
  readonly filename: string;
  readonly subfolder: string;
  readonly type: ImageType;
}

export interface UploadImageResponse {
  readonly name: string;
  readonly subfolder: string;
  readonly type: ImageType;
}

export interface NodeOutputs {
  readonly images?: readonly ImageRef[];
  readonly gifs?: readonly ImageRef[];
  readonly [key: string]: unknown;
}

export interface WorkflowNode {
  readonly class_type: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly _meta?: { readonly title?: string };
}

export type WorkflowGraph = Readonly<Record<string, WorkflowNode>>;

export interface PromptRequest {
  readonly client_id: string;
  readonly prompt: WorkflowGraph;
  readonly extra_data?: Readonly<Record<string, unknown>>;
}

export interface PromptResponse {
  readonly prompt_id: string;
  readonly number: number;
  readonly node_errors: Readonly<Record<string, NodeError>>;
}

export interface NodeError {
  readonly errors: readonly {
    readonly type: string;
    readonly message: string;
    readonly details: string;
    readonly extra_info: Readonly<Record<string, unknown>>;
  }[];
  readonly dependent_outputs: readonly string[];
  readonly class_type: string;
}

export interface PromptValidationError {
  readonly error: {
    readonly type: string;
    readonly message: string;
    readonly details: string;
    readonly extra_info: Readonly<Record<string, unknown>>;
  };
  readonly node_errors: Readonly<Record<string, NodeError>>;
}

export type HistoryStatusStr = 'success' | 'error';

export type HistoryMessageTuple =
  | readonly ['execution_start', { readonly prompt_id: string; readonly timestamp: number }]
  | readonly [
      'execution_cached',
      { readonly nodes: readonly string[]; readonly prompt_id: string; readonly timestamp: number },
    ]
  | readonly ['execution_success', { readonly prompt_id: string; readonly timestamp: number }]
  | readonly ['execution_error', ExecutionErrorPayload]
  | readonly [string, Readonly<Record<string, unknown>>];

export interface ExecutionErrorPayload {
  readonly prompt_id: string;
  readonly node_id: string;
  readonly node_type: string;
  readonly executed: readonly string[];
  readonly exception_message: string;
  readonly exception_type: string;
  readonly traceback: readonly string[];
  readonly current_inputs?: Readonly<Record<string, unknown>>;
  readonly current_outputs?: Readonly<Record<string, unknown>>;
}

export interface HistoryEntry {
  readonly prompt: readonly [
    number,
    string,
    WorkflowGraph,
    Readonly<Record<string, unknown>>,
    readonly string[],
  ];
  readonly outputs: Readonly<Record<string, NodeOutputs>>;
  readonly status: {
    readonly status_str: HistoryStatusStr;
    readonly completed: boolean;
    readonly messages: readonly HistoryMessageTuple[];
  };
  readonly meta?: Readonly<
    Record<
      string,
      {
        readonly node_id: string;
        readonly display_node: string;
        readonly parent_node: string | null;
        readonly real_node_id: string;
      }
    >
  >;
}

export type HistoryResponse = Readonly<Record<string, HistoryEntry>>;

export interface QueueResponse {
  readonly queue_running: readonly QueueItem[];
  readonly queue_pending: readonly QueueItem[];
}

export type QueueItem = readonly [
  number,
  string,
  WorkflowGraph,
  Readonly<Record<string, unknown>>,
  readonly string[],
];

export interface SystemStatsResponse {
  readonly system: {
    readonly os: string;
    readonly comfyui_version: string;
    readonly python_version: string;
    readonly pytorch_version: string;
    readonly ram_total: number;
    readonly ram_free: number;
    readonly embedded_python: boolean;
    readonly argv: readonly string[];
  };
  readonly devices: readonly {
    readonly name: string;
    readonly type: string;
    readonly index: number;
    readonly vram_total: number;
    readonly vram_free: number;
  }[];
}

// WebSocket message types

export interface WsStatusMessage {
  readonly type: 'status';
  readonly data: {
    readonly status: { readonly exec_info: { readonly queue_remaining: number } };
    readonly sid?: string;
  };
}

export interface WsExecutionStartMessage {
  readonly type: 'execution_start';
  readonly data: { readonly prompt_id: string; readonly timestamp: number };
}

export interface WsExecutionCachedMessage {
  readonly type: 'execution_cached';
  readonly data: {
    readonly nodes: readonly string[];
    readonly prompt_id: string;
    readonly timestamp: number;
  };
}

export interface WsExecutingMessage {
  readonly type: 'executing';
  readonly data: {
    readonly node: string | null;
    readonly display_node: string | null;
    readonly prompt_id: string;
  };
}

export interface WsProgressMessage {
  readonly type: 'progress';
  readonly data: {
    readonly value: number;
    readonly max: number;
    readonly prompt_id: string;
    readonly node: string;
  };
}

export interface WsExecutedMessage {
  readonly type: 'executed';
  readonly data: {
    readonly node: string;
    readonly display_node: string;
    readonly output: NodeOutputs;
    readonly prompt_id: string;
  };
}

export interface WsExecutionSuccessMessage {
  readonly type: 'execution_success';
  readonly data: { readonly prompt_id: string; readonly timestamp: number };
}

export interface WsExecutionErrorMessage {
  readonly type: 'execution_error';
  readonly data: ExecutionErrorPayload;
}

export interface WsExecutionInterruptedMessage {
  readonly type: 'execution_interrupted';
  readonly data: {
    readonly prompt_id: string;
    readonly node_id: string;
    readonly node_type: string;
    readonly executed: readonly string[];
  };
}

export type WsMessage =
  | WsStatusMessage
  | WsExecutionStartMessage
  | WsExecutionCachedMessage
  | WsExecutingMessage
  | WsProgressMessage
  | WsExecutedMessage
  | WsExecutionSuccessMessage
  | WsExecutionErrorMessage
  | WsExecutionInterruptedMessage
  | { readonly type: string; readonly data: Readonly<Record<string, unknown>> };

// Domain errors

export type ComfyError =
  | { readonly kind: 'network'; readonly message: string; readonly cause?: unknown }
  | { readonly kind: 'http'; readonly status: number; readonly body: string }
  | {
      readonly kind: 'validation';
      readonly message: string;
      readonly nodeErrors: Readonly<Record<string, NodeError>>;
    }
  | { readonly kind: 'execution'; readonly payload: ExecutionErrorPayload }
  | {
      readonly kind: 'timeout';
      readonly message: string;
      readonly elapsedMs: number;
    }
  | { readonly kind: 'aborted'; readonly message: string };

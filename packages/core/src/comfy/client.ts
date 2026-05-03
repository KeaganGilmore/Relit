import { err, ok, type Result } from '../result.js';
import type {
  ComfyError,
  HistoryEntry,
  HistoryResponse,
  ImageRef,
  ImageType,
  PromptRequest,
  PromptResponse,
  PromptValidationError,
  QueueResponse,
  SystemStatsResponse,
  UploadImageResponse,
  WorkflowGraph,
} from './types.js';

export interface ComfyClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly clientId?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:8188';

const isPromptValidationError = (v: unknown): v is PromptValidationError =>
  typeof v === 'object' &&
  v !== null &&
  'error' in v &&
  typeof (v as { error: unknown }).error === 'object' &&
  (v as { error: unknown }).error !== null &&
  'node_errors' in v;

const networkErr = (message: string, cause?: unknown): ComfyError => ({
  kind: 'network',
  message,
  ...(cause === undefined ? {} : { cause }),
});

const httpErr = (status: number, body: string): ComfyError => ({ kind: 'http', status, body });

export class ComfyClient {
  readonly baseUrl: string;
  readonly clientId: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(options: ComfyClientOptions = { baseUrl: DEFAULT_BASE_URL }) {
    this.baseUrl = stripTrailingSlash(options.baseUrl);
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.clientId = options.clientId ?? generateClientId();
  }

  /** Liveness probe + version info. */
  async systemStats(): Promise<Result<SystemStatsResponse, ComfyError>> {
    return this.getJson<SystemStatsResponse>('/system_stats');
  }

  /** Multipart upload. Returns the canonical path the LoadImage node should reference. */
  async uploadImage(
    file: Blob | { readonly data: Uint8Array; readonly filename: string; readonly mime?: string },
    opts: {
      readonly subfolder?: string;
      readonly type?: ImageType;
      readonly overwrite?: boolean;
    } = {},
  ): Promise<Result<UploadImageResponse, ComfyError>> {
    const form = new FormData();
    if (file instanceof Blob) {
      form.append('image', file);
    } else {
      const blob = new Blob([file.data as BlobPart], { type: file.mime ?? 'image/png' });
      form.append('image', blob, file.filename);
    }
    if (opts.subfolder !== undefined) form.append('subfolder', opts.subfolder);
    if (opts.type !== undefined) form.append('type', opts.type);
    if (opts.overwrite) form.append('overwrite', 'true');

    return this.postForm<UploadImageResponse>('/upload/image', form);
  }

  /** Submit a workflow graph for queueing. */
  async submitPrompt(prompt: WorkflowGraph): Promise<Result<PromptResponse, ComfyError>> {
    const body: PromptRequest = { client_id: this.clientId, prompt };
    return this.postJson<PromptResponse, ComfyError>('/prompt', body, async (status, text) => {
      if (status === 400) {
        try {
          const parsed = JSON.parse(text) as unknown;
          if (isPromptValidationError(parsed)) {
            return {
              kind: 'validation',
              message: parsed.error.message,
              nodeErrors: parsed.node_errors,
            };
          }
        } catch {
          // fall through
        }
      }
      return httpErr(status, text);
    });
  }

  async history(promptId?: string): Promise<Result<HistoryResponse, ComfyError>> {
    const path = promptId ? `/history/${encodeURIComponent(promptId)}` : '/history?max_items=64';
    return this.getJson<HistoryResponse>(path);
  }

  async historyEntry(promptId: string): Promise<Result<HistoryEntry | null, ComfyError>> {
    const r = await this.history(promptId);
    if (!r.ok) return r;
    const entry = r.value[promptId];
    return ok(entry ?? null);
  }

  async queue(): Promise<Result<QueueResponse, ComfyError>> {
    return this.getJson<QueueResponse>('/queue');
  }

  /** Build a `/view` URL. Handy for `<img>` src. */
  viewUrl(ref: ImageRef): string {
    const params = new URLSearchParams({
      filename: ref.filename,
      subfolder: ref.subfolder,
      type: ref.type,
    });
    return `${this.baseUrl}/view?${params.toString()}`;
  }

  async downloadImage(ref: ImageRef): Promise<Result<Uint8Array, ComfyError>> {
    try {
      const res = await this.fetchFn(this.viewUrl(ref));
      if (!res.ok) return err(httpErr(res.status, await safeText(res)));
      const buf = await res.arrayBuffer();
      return ok(new Uint8Array(buf));
    } catch (e) {
      return err(networkErr(`view ${ref.filename}: ${stringifyErr(e)}`, e));
    }
  }

  /** Build the `/ws` URL for the constructor's clientId. */
  wsUrl(): string {
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    return `${wsBase}/ws?clientId=${encodeURIComponent(this.clientId)}`;
  }

  // --- internals ---

  private async getJson<T>(path: string): Promise<Result<T, ComfyError>> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`);
      if (!res.ok) return err(httpErr(res.status, await safeText(res)));
      return ok((await res.json()) as T);
    } catch (e) {
      return err(networkErr(`GET ${path}: ${stringifyErr(e)}`, e));
    }
  }

  private async postForm<T>(path: string, form: FormData): Promise<Result<T, ComfyError>> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, { method: 'POST', body: form });
      if (!res.ok) return err(httpErr(res.status, await safeText(res)));
      return ok((await res.json()) as T);
    } catch (e) {
      return err(networkErr(`POST ${path}: ${stringifyErr(e)}`, e));
    }
  }

  private async postJson<T, E extends ComfyError>(
    path: string,
    body: unknown,
    mapStatus: (status: number, text: string) => Promise<E | ComfyError>,
  ): Promise<Result<T, ComfyError>> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return err(await mapStatus(res.status, await safeText(res)));
      return ok((await res.json()) as T);
    } catch (e) {
      return err(networkErr(`POST ${path}: ${stringifyErr(e)}`, e));
    }
  }
}

const stripTrailingSlash = (s: string): string => (s.endsWith('/') ? s.slice(0, -1) : s);

const stringifyErr = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);

const safeText = async (res: Response): Promise<string> => {
  try {
    return await res.text();
  } catch {
    return '';
  }
};

const generateClientId = (): string => {
  const c =
    typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `relit-${c}`;
};

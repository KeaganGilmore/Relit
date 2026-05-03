import type { WsMessage } from './types.js';

export type WsState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface WsClientOptions {
  readonly url: string;
  readonly WebSocketCtor?: typeof WebSocket;
  /** Reconnect backoff in ms. Stops after the array runs out and stays at the last value. */
  readonly reconnectDelaysMs?: readonly number[];
  /** Optional setTimeout / clearTimeout for tests. Defaults to globalThis. */
  readonly setTimeout?: (handler: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

type Listener<T> = (value: T) => void;

const DEFAULT_BACKOFF = [200, 500, 1000, 2000, 5000] as const;

export class ComfyWsClient {
  private socket: WebSocket | null = null;
  private state: WsState = 'idle';
  private wantOpen = false;
  private reconnectAttempt = 0;
  private reconnectTimer: unknown = null;

  private readonly url: string;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly backoff: readonly number[];
  private readonly setTimeoutFn: (h: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (h: unknown) => void;

  private readonly messageListeners = new Set<Listener<WsMessage>>();
  private readonly stateListeners = new Set<Listener<WsState>>();
  private readonly binaryListeners = new Set<Listener<ArrayBuffer>>();

  constructor(options: WsClientOptions) {
    this.url = options.url;
    const ctor =
      options.WebSocketCtor ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!ctor) {
      throw new Error('No WebSocket constructor available; pass WebSocketCtor explicitly.');
    }
    this.WebSocketCtor = ctor;
    this.backoff = options.reconnectDelaysMs ?? DEFAULT_BACKOFF;
    this.setTimeoutFn = options.setTimeout ?? ((h, ms) => globalThis.setTimeout(h, ms));
    this.clearTimeoutFn =
      options.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  getState(): WsState {
    return this.state;
  }

  connect(): void {
    this.wantOpen = true;
    if (this.state === 'open' || this.state === 'connecting') return;
    this.openSocket();
  }

  close(): void {
    this.wantOpen = false;
    if (this.reconnectTimer !== null) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.setState('closed');
  }

  onMessage(listener: Listener<WsMessage>): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onBinary(listener: Listener<ArrayBuffer>): () => void {
    this.binaryListeners.add(listener);
    return () => this.binaryListeners.delete(listener);
  }

  onStateChange(listener: Listener<WsState>): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private openSocket(): void {
    this.setState(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    let socket: WebSocket;
    try {
      socket = new this.WebSocketCtor(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState('open');
    };
    socket.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        try {
          const parsed = JSON.parse(ev.data) as WsMessage;
          for (const l of this.messageListeners) l(parsed);
        } catch {
          // drop unparseable text frames silently — server bug, not ours
        }
      } else if (ev.data instanceof ArrayBuffer) {
        for (const l of this.binaryListeners) l(ev.data);
      }
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.wantOpen) this.scheduleReconnect();
      else this.setState('closed');
    };
    socket.onerror = () => {
      // onclose will follow; nothing to do here.
    };
  }

  private scheduleReconnect(): void {
    const delay = this.backoff[Math.min(this.reconnectAttempt, this.backoff.length - 1)] ?? 1000;
    this.reconnectAttempt += 1;
    this.setState('reconnecting');
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (this.wantOpen) this.openSocket();
    }, delay);
  }

  private setState(next: WsState): void {
    if (this.state === next) return;
    this.state = next;
    for (const l of this.stateListeners) l(next);
  }
}

import { describe, expect, it, vi } from 'vitest';
import { ComfyWsClient, type WsState } from './ws.js';
import type { WsMessage } from './types.js';

class FakeSocket {
  static instances: FakeSocket[] = [];
  binaryType: BinaryType = 'blob';
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  readyState = 0;
  closed = false;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  emit(text: string) {
    this.onmessage?.({ data: text } as MessageEvent);
  }

  emitBinary(buf: ArrayBuffer) {
    this.onmessage?.({ data: buf } as MessageEvent);
  }

  fail() {
    this.onerror?.(new Event('error'));
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

const setupClient = () => {
  FakeSocket.instances = [];
  const timers: { handler: () => void; ms: number }[] = [];
  const setTimeoutFn = vi.fn((handler: () => void, ms: number) => {
    timers.push({ handler, ms });
    return timers.length - 1;
  });
  const clearTimeoutFn = vi.fn();
  const client = new ComfyWsClient({
    url: 'ws://test/ws',
    WebSocketCtor: FakeSocket as unknown as typeof WebSocket,
    reconnectDelaysMs: [10, 20, 30],
    setTimeout: setTimeoutFn as unknown as (h: () => void, ms: number) => unknown,
    clearTimeout: clearTimeoutFn,
  });
  const fireTimer = (i = timers.length - 1) => {
    const t = timers[i];
    if (t) t.handler();
  };
  return { client, setTimeoutFn, clearTimeoutFn, timers, fireTimer };
};

describe('ComfyWsClient', () => {
  it('throws when no WebSocket constructor is available on the global', () => {
    const original = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    try {
      expect(() => new ComfyWsClient({ url: 'ws://test' })).toThrow(/No WebSocket constructor/);
    } finally {
      if (original) (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = original;
    }
  });

  it('parses text frames as WsMessage and dispatches', () => {
    const { client } = setupClient();
    const messages: WsMessage[] = [];
    client.onMessage((m) => messages.push(m));
    client.connect();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.emit(JSON.stringify({ type: 'execution_start', data: { prompt_id: 'p', timestamp: 1 } }));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe('execution_start');
  });

  it('drops unparseable text frames without throwing', () => {
    const { client } = setupClient();
    client.connect();
    FakeSocket.instances[0]!.open();
    expect(() => FakeSocket.instances[0]!.emit('not-json{')).not.toThrow();
  });

  it('dispatches binary frames separately', () => {
    const { client } = setupClient();
    const bins: ArrayBuffer[] = [];
    client.onBinary((b) => bins.push(b));
    client.connect();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.emitBinary(new ArrayBuffer(8));
    expect(bins).toHaveLength(1);
    expect(bins[0]?.byteLength).toBe(8);
  });

  it('emits state transitions: connecting → open → reconnecting → open', () => {
    const { client, fireTimer } = setupClient();
    const states: WsState[] = [];
    client.onStateChange((s) => states.push(s));
    client.connect();
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.fail();
    fireTimer();
    FakeSocket.instances[1]!.open();
    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'open']);
  });

  it('does not reconnect after explicit close()', () => {
    const { client } = setupClient();
    client.connect();
    FakeSocket.instances[0]!.open();
    client.close();
    expect(client.getState()).toBe('closed');
    FakeSocket.instances[0]!.fail();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('uses progressively longer backoffs and clamps to the final value', () => {
    const { client, setTimeoutFn, fireTimer } = setupClient();
    client.connect();
    for (let i = 0; i < 5; i++) {
      const sock = FakeSocket.instances[i]!;
      sock.fail();
      fireTimer();
    }
    const delays = setTimeoutFn.mock.calls.map((c) => c[1]);
    expect(delays).toEqual([10, 20, 30, 30, 30]);
  });

  it('connect() is idempotent while connecting/open', () => {
    const { client } = setupClient();
    client.connect();
    client.connect();
    FakeSocket.instances[0]!.open();
    client.connect();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

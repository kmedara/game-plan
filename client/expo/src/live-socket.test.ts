/**
 * The live socket reconnects after a drop, asks listeners to catch up, and keeps itself alive.
 */

import type { ApiClient } from './api';
import { LiveSocket } from './live-socket';

type Handler = (event?: unknown) => void;

/** Minimal browser WebSocket the tests drive by hand. */
class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  readonly sent: string[] = [];
  private readonly handlers = new Map<string, Handler[]>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: Handler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  emit(type: string, event?: unknown): void {
    if (type === 'open') this.readyState = FakeSocket.OPEN;
    if (type === 'close') this.readyState = 3;
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
}

const api = { issueSocketTicket: async () => ({ ticket: 'ticket' }) } as unknown as ApiClient;

/** Lets the ticket request and socket construction settle. */
const settle = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

describe('LiveSocket', () => {
  const original = globalThis.WebSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    FakeSocket.instances = [];
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.WebSocket = original;
  });

  it('asks for a catch-up on every reopen after the first', async () => {
    const live = new LiveSocket(api);
    const reconnected = jest.fn();
    live.subscribe(() => undefined);
    live.onReconnect(reconnected);

    live.connect();
    await settle();
    FakeSocket.instances[0]?.emit('open');
    expect(reconnected).not.toHaveBeenCalled();

    FakeSocket.instances[0]?.emit('close');
    jest.advanceTimersByTime(2000);
    await settle();
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1]?.emit('open');
    expect(reconnected).toHaveBeenCalledTimes(1);
    live.disconnect();
  });

  it('pings an open socket and replaces one that died silently', async () => {
    const live = new LiveSocket(api);
    live.subscribe(() => undefined);
    live.connect();
    await settle();
    const first = FakeSocket.instances[0];
    first?.emit('open');

    jest.advanceTimersByTime(4 * 60 * 1000);
    expect(first?.sent).toEqual(['{"type":"ping"}']);

    if (first !== undefined) first.readyState = 3;
    jest.advanceTimersByTime(4 * 60 * 1000);
    jest.advanceTimersByTime(2000);
    await settle();
    expect(FakeSocket.instances).toHaveLength(2);
    live.disconnect();
  });
});

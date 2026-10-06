import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSocketService } from './live-socket.service';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();
  readyState = 1;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  close(): void {
    this.readyState = 3;
  }

  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe('LiveSocketService', () => {
  let service: LiveSocketService;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    TestBed.configureTestingModule({});
    service = TestBed.inject(LiveSocketService);
  });

  afterEach(() => {
    service?.disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('delivers JSON string frames to subscribers', async () => {
    const listener = vi.fn();
    service.subscribe(listener);
    service.connect('token');
    const socket = FakeWebSocket.instances[0];
    expect(socket?.url).toContain('token=token');
    socket?.emit('message', {
      data: JSON.stringify({ type: 'chat.message', teamId: 't1' }),
    });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith({ type: 'chat.message', teamId: 't1' });
    });
  });

  it('reads Blob and ArrayBuffer frames', async () => {
    const listener = vi.fn();
    service.subscribe(listener);
    service.connect('token');
    const socket = FakeWebSocket.instances[0];
    const payload = { type: 'schedule.updated', teamId: 't1' };
    socket?.emit('message', {
      data: new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(payload));
    listener.mockClear();
    socket?.emit('message', {
      data: new TextEncoder().encode(JSON.stringify(payload)).buffer,
    });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(payload));
  });

  it('stringifies unknown frame types and ignores bad JSON', async () => {
    const listener = vi.fn();
    service.subscribe(listener);
    service.connect('token');
    const socket = FakeWebSocket.instances[0];
    socket?.emit('message', { data: { note: 'not a string frame' } });
    socket?.emit('message', { data: '{not-json' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).not.toHaveBeenCalled();
  });

  it('reconnects after close while a token remains', () => {
    vi.useFakeTimers();
    service.connect('token');
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]?.emit('close', {});
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });

  it('does not reconnect when the socket closes after a disconnect', () => {
    vi.useFakeTimers();
    service.connect('token');
    service.disconnect();
    FakeWebSocket.instances[0]?.emit('close', {});
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('cancels a pending reconnect when disconnected before the timer fires', () => {
    vi.useFakeTimers();
    service.connect('token');
    FakeWebSocket.instances[0]?.emit('close', {});
    service.disconnect();
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

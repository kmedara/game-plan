/**
 * WebSocket subscription for live chat and schedule delivery.
 *
 * Each connect uses a one-time ticket from `POST /identity/socket-ticket`.
 *
 * Events sent while the socket is down are not replayed, and phones drop the
 * socket whenever the app or tab goes to the background. Every reconnect after
 * the first therefore tells {@link LiveSocket.onReconnect} listeners to refetch.
 */

import { AppState, Platform } from 'react-native';
import type { FanoutJob } from '@gameplan/types';
import type { ApiClient } from './api';
import { config } from './config';

type LiveListener = (event: FanoutJob) => void;

const RECONNECT_DELAY_MS = 2000;

/**
 * How often an open socket sends a keepalive frame.
 *
 * API Gateway closes a WebSocket after 10 idle minutes. A send on a socket the
 * phone already killed also surfaces the dead socket so it can be replaced.
 */
const KEEPALIVE_MS = 4 * 60 * 1000;

const frameText = async (data: unknown): Promise<string> => {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data);
};

/**
 * Opens a WebSocket while the app is foregrounded and exposes live events.
 */
export class LiveSocket {
  private socket: WebSocket | undefined;
  private session = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<LiveListener>();
  private readonly reconnectListeners = new Set<() => void>();
  private keepalive: ReturnType<typeof setInterval> | undefined;
  private everOpened = false;
  private paused = false;

  constructor(private readonly api: ApiClient) {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        this.paused = false;
        if (this.listeners.size > 0) this.connect();
        return;
      }
      this.paused = true;
      this.disconnect();
    });
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Safari restores a page from its back-forward cache without a visibility
      // change, with the old socket already closed. A network change can leave a
      // socket that never reports `close`.
      const revive = (): void => {
        if (!this.paused && this.listeners.size > 0) this.connect();
      };
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) revive();
      });
      window.addEventListener('online', revive);
    }
  }

  subscribe(listener: LiveListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Runs `listener` each time the socket opens again after an earlier connection,
   * so callers can refetch what was missed while it was down.
   */
  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  connect(): void {
    if (this.paused) return;
    this.clearReconnect();
    this.session += 1;
    void this.open(this.session);
  }

  disconnect(): void {
    this.session += 1;
    this.clearReconnect();
    this.disconnectSocketOnly();
  }

  private async open(session: number): Promise<void> {
    this.disconnectSocketOnly();
    let ticket: string;
    try {
      ({ ticket } = await this.api.issueSocketTicket());
    } catch {
      this.scheduleReconnect(session);
      return;
    }
    if (session !== this.session) return;

    const url = `${config.wsBaseUrl}?ticket=${encodeURIComponent(ticket)}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.startKeepalive(socket, session);
      if (this.everOpened) for (const listener of this.reconnectListeners) listener();
      this.everOpened = true;
    });
    socket.addEventListener('message', (event) => {
      void frameText(event.data)
        .then((text) => {
          const payload = JSON.parse(text) as FanoutJob;
          for (const listener of this.listeners) listener(payload);
        })
        .catch(() => undefined);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.stopKeepalive();
      this.scheduleReconnect(session);
    });
  }

  private startKeepalive(socket: WebSocket, session: number): void {
    this.stopKeepalive();
    this.keepalive = setInterval(() => {
      if (this.socket !== socket) return;
      if (socket.readyState !== WebSocket.OPEN) {
        this.stopKeepalive();
        this.scheduleReconnect(session);
        return;
      }
      try {
        socket.send('{"type":"ping"}');
      } catch {
        this.stopKeepalive();
        this.scheduleReconnect(session);
      }
    }, KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepalive === undefined) return;
    clearInterval(this.keepalive);
    this.keepalive = undefined;
  }

  private scheduleReconnect(session: number): void {
    if (session !== this.session || this.paused) return;
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (session === this.session) void this.open(session);
    }, RECONNECT_DELAY_MS);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer === undefined) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private disconnectSocketOnly(): void {
    this.stopKeepalive();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }
}

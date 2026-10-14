/**
 * WebSocket subscription for live chat and schedule delivery.
 *
 * Each connect uses a one-time ticket from `POST /identity/socket-ticket`.
 */

import { AppState } from 'react-native';
import type { FanoutJob } from '@gameplan/types';
import type { ApiClient } from './api';
import { config } from './config';

type LiveListener = (event: FanoutJob) => void;

const RECONNECT_DELAY_MS = 2000;

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
  }

  subscribe(listener: LiveListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
      this.scheduleReconnect(session);
    });
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
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }
}

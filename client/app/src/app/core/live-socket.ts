/**
 * Browser WebSocket subscription for live chat and schedule delivery.
 */

import { Injectable, NgZone } from '@angular/core';
import { environment } from '../../environments/environment';

/** Fan-out payload shapes delivered over the socket. */
export type LiveEvent =
  | {
      type: 'chat_message';
      chatId: string;
      messageId: string;
      senderId: string;
      body: string;
      createdAt: string;
      attachmentKeys?: string[];
    }
  | {
      type: 'schedule_changed';
      teamId: string;
      eventId: string;
    };

type LiveListener = (event: LiveEvent) => void;

/**
 * Reads a WebSocket message payload as UTF-8 text.
 *
 * Local and cloud delivery should use text frames. Binary frames (Blob /
 * ArrayBuffer) are decoded so a misconfigured sender still works.
 *
 * @param data - `MessageEvent.data` from the browser WebSocket.
 * @returns The payload text.
 */
const messageText = async (data: unknown): Promise<string> => {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data as ArrayBufferView);
  }
  return String(data);
};

/**
 * Opens a WebSocket while the app is foregrounded and exposes live events.
 */
@Injectable({ providedIn: 'root' })
export class LiveSocket {
  private socket: WebSocket | undefined;
  private token: string | undefined;
  /** Bumps on each connect/disconnect so stale close handlers do not reconnect. */
  private generation = 0;
  private readonly listeners = new Set<LiveListener>();

  constructor(private readonly zone: NgZone) {}

  /**
   * Subscribes to live fan-out events.
   *
   * @param listener - Callback invoked on each event.
   * @returns An unsubscribe function.
   */
  subscribe(listener: LiveListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Connects (or reconnects) with the current access token.
   *
   * @param accessToken - Cognito or local access JWT.
   */
  connect(accessToken: string): void {
    this.token = accessToken;
    this.disconnectSocketOnly();
    const generation = ++this.generation;
    const url = `${environment.wsBaseUrl}?token=${encodeURIComponent(accessToken)}`;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => {
      void messageText(event.data)
        .then((text) => {
          const payload = JSON.parse(text) as LiveEvent;
          if (generation !== this.generation) return;
          this.zone.run(() => {
            for (const listener of this.listeners) listener(payload);
          });
        })
        .catch(() => {
          // Ignore non-JSON frames.
        });
    });
    this.socket.addEventListener('close', () => {
      if (this.token === undefined || generation !== this.generation) return;
      window.setTimeout(() => {
        if (this.token !== undefined && generation === this.generation) {
          this.connect(this.token);
        }
      }, 2000);
    });
  }

  /** Closes the socket and stops reconnect attempts. */
  disconnect(): void {
    this.token = undefined;
    this.disconnectSocketOnly();
  }

  private disconnectSocketOnly(): void {
    this.generation += 1;
    this.socket?.close();
    this.socket = undefined;
  }
}

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
 * Opens a WebSocket while the app is foregrounded and exposes live events.
 */
@Injectable({ providedIn: 'root' })
export class LiveSocket {
  private socket: WebSocket | undefined;
  private token: string | undefined;
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
    const url = `${environment.wsBaseUrl}?token=${encodeURIComponent(accessToken)}`;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as LiveEvent;
        this.zone.run(() => {
          for (const listener of this.listeners) listener(payload);
        });
      } catch {
        // Ignore non-JSON frames.
      }
    });
    this.socket.addEventListener('close', () => {
      if (this.token === undefined) return;
      window.setTimeout(() => {
        if (this.token !== undefined) this.connect(this.token);
      }, 2000);
    });
  }

  /** Closes the socket and stops reconnect attempts. */
  disconnect(): void {
    this.token = undefined;
    this.disconnectSocketOnly();
  }

  private disconnectSocketOnly(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}

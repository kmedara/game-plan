/**
 * Browser WebSocket subscription for live chat and schedule delivery.
 */

import { Injectable, NgZone } from '@angular/core';
import type { FanoutJob } from '@gameplan/types';
import { environment } from '../../environments/environment';

type LiveListener = (event: FanoutJob) => void;

/**
 * Reads a WebSocket frame as text.
 *
 * Text frames arrive as strings. A binary frame arrives as a Blob, and
 * `String(blob)` is not the JSON body.
 *
 * @param data - The `MessageEvent` data.
 * @returns The frame text.
 */
const frameText = async (data: unknown): Promise<string> => {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data);
};

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
      void frameText(event.data)
        .then((text) => {
          const payload = JSON.parse(text) as FanoutJob;
          this.zone.run(() => {
            for (const listener of this.listeners) listener(payload);
          });
        })
        .catch(() => {
          // Ignore non-JSON frames.
        });
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

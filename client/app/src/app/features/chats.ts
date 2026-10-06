/**
 * Chat list and message thread screens.
 */

import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { ChatMessage, ChatSummary } from '@gameplan/types';
import { ApiClient } from '../core/api-client';
import { LiveSocket } from '../core/live-socket';

/** Name shown when a live event arrives without a profile name. */
const FALLBACK_SENDER_NAME = 'Player';

/**
 * Initials shown when a sender has no profile photo.
 *
 * @param displayName - The sender's display name.
 * @returns Up to two uppercase letters.
 */
const initialsOf = (displayName: string): string => {
  const parts = displayName.trim().split(/\s+/u).filter((part) => part.length > 0);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '');
  const initials = letters.join('');
  return initials.length > 0 ? initials : '?';
};

@Component({
  selector: 'app-chats',
  standalone: true,
  imports: [RouterLink, MatButtonModule],
  templateUrl: './chats.html',
})
export class ChatsPageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  readonly teamGroups = signal<{ label: string; items: ChatSummary[] }[]>([]);
  readonly privateChats = signal<ChatSummary[]>([]);
  readonly onATeam = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const [chats, teams] = await Promise.all([this.api.listChats(), this.api.listTeams()]);
    const member = teams.length > 0;
    this.onATeam.set(member);
    this.teamGroups.set(
      member
        ? [
            { label: 'Team', items: chats.filter((c) => c.kind === 'default') },
            { label: 'Channels', items: chats.filter((c) => c.kind === 'channel') },
          ]
        : [],
    );
    this.privateChats.set(chats.filter((c) => c.kind === 'private'));
  }
}

@Component({
  selector: 'app-chat-thread',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
    TextFieldModule,
  ],
  templateUrl: './chat-thread.html',
})
export class ChatThreadPageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);
  private readonly live = inject(LiveSocket);

  readonly messages = signal<ChatMessage[]>([]);
  /** Title shown in the thread header. */
  readonly chatName = signal('');
  /** Message whose sender and time are visible. */
  readonly revealedMessageId = signal<string | null>(null);
  /** Download URLs keyed by profile photo object key. */
  readonly photoUrls = signal<Record<string, string>>({});
  draft = '';
  private chatId = '';
  /** Photo keys already being resolved, so a live message does not fetch twice. */
  private readonly photoLoads = new Set<string>();

  ngOnInit(): void {
    this.chatId = this.route.snapshot.paramMap.get('chatId') ?? '';
    void this.load();
    this.live.subscribe((event) => {
      if (event.type === 'chat_message' && event.chatId === this.chatId) {
        this.upsertMessage({
          messageId: event.messageId,
          chatId: event.chatId,
          senderId: event.senderId,
          senderDisplayName: event.senderDisplayName ?? FALLBACK_SENDER_NAME,
          ...(event.senderPhotoKey !== undefined
            ? { senderPhotoKey: event.senderPhotoKey }
            : {}),
          body: event.body,
          attachmentKeys: event.attachmentKeys,
          createdAt: event.createdAt,
        });
      }
    });
  }

  /**
   * Returns the name shown above a message.
   *
   * @param message - The thread message.
   * @returns The sender's display name.
   */
  /**
   * Shows the sender and time for one message, or hides them on a second click.
   *
   * @param messageId - The message that was clicked.
   */
  toggleMeta(messageId: string): void {
    this.revealedMessageId.update((current) => (current === messageId ? null : messageId));
  }

  senderName(message: ChatMessage): string {
    return message.senderDisplayName;
  }

  /**
   * Returns initials for the thumbnail when the sender has no photo.
   *
   * @param message - The thread message.
   * @returns Up to two uppercase letters.
   */
  initials(message: ChatMessage): string {
    return initialsOf(this.senderName(message));
  }

  /**
   * Returns a display URL for the sender's profile photo.
   *
   * @param message - The thread message.
   * @returns The download URL once presigned, otherwise `undefined`.
   */
  photoUrl(message: ChatMessage): string | undefined {
    const key = message.senderPhotoKey;
    if (key === undefined) return undefined;
    return this.photoUrls()[key];
  }

  /**
   * Inserts a message at the top, replacing any copy with the same id.
   *
   * The send response and the live event both carry the stored message. Keeping
   * one row stops the sender from seeing it twice.
   *
   * @param message - The message to show.
   */
  private upsertMessage(message: ChatMessage): void {
    this.messages.update((list) => [
      message,
      ...list.filter((item) => item.messageId !== message.messageId),
    ]);
    void this.loadSenderPhotos([message]);
  }

  private async load(): Promise<void> {
    const [page] = await Promise.all([this.api.listMessages(this.chatId), this.loadChatName()]);
    this.messages.set(page.messages);
    await this.loadSenderPhotos(page.messages);
  }

  /**
   * Sets the header from the chat list. A failed lookup leaves the title blank.
   */
  private async loadChatName(): Promise<void> {
    try {
      const chats = await this.api.listChats();
      const name = chats.find((chat) => chat.chatId === this.chatId)?.name;
      if (name !== undefined) this.chatName.set(name);
    } catch {
      // The thread still opens when the chat list cannot be loaded.
    }
  }

  /**
   * Presigns profile photos that are not already on screen.
   *
   * A failed download leaves the initials in the thumbnail.
   *
   * @param messages - Messages whose senders may have a photo.
   */
  private async loadSenderPhotos(messages: readonly ChatMessage[]): Promise<void> {
    const pending: string[] = [];
    for (const key of new Set(messages.map((message) => message.senderPhotoKey))) {
      if (key === undefined || this.photoUrls()[key] !== undefined || this.photoLoads.has(key)) {
        continue;
      }
      this.photoLoads.add(key);
      pending.push(key);
    }
    await Promise.all(
      pending.map(async (key) => {
        try {
          const download = await this.api.presignDownload(key);
          this.photoUrls.update((current) => ({ ...current, [key]: download.downloadUrl }));
        } catch {
          // Initials stay in the thumbnail when the photo cannot be loaded.
        } finally {
          this.photoLoads.delete(key);
        }
      }),
    );
  }

  /**
   * Sends on Enter. Shift+Enter keeps a line break in the draft.
   *
   * @param event - The keydown event from the message field.
   */
  submitDraft(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  async send(): Promise<void> {
    const body = this.draft.trim();
    if (body.length === 0) return;
    this.draft = '';
    const message = await this.api.sendMessage(this.chatId, body);
    this.upsertMessage(message);
  }
}

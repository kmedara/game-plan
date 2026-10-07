/**
 * Chat list and message thread screens.
 */

import { DatePipe } from '@angular/common';
import {
  Component,
  OnInit,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { ChatMessage, ChatSummary } from '@gameplan/types';
import { ActiveTeamService } from '../core/active-team.service';
import { ApiClientService } from '../core/api-client.service';
import { LiveSocketService } from '../core/live-socket.service';
import { ModalService } from '../core/modal.service';
import { AddChatChooserComponent } from './add-chat-chooser';
import { CreateChannelComponent } from './create-channel';
import { CreatePrivateChatComponent } from './create-private-chat';

/** Name shown when a live event arrives without a profile name. */
const FALLBACK_SENDER_NAME = 'Player';

/** Image types accepted for chat attachments. */
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Largest image the chat composer will upload. */
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Most images that can ride on one message. */
const MAX_ATTACHMENTS = 10;

/** A local preview for an uploaded chat image waiting to send. */
type PendingAttachment = {
  key: string;
  previewUrl: string;
};

/**
 * Initials shown when a sender has no profile photo.
 *
 * @param displayName - The sender's display name.
 * @returns Up to two uppercase letters.
 */
const initialsOf = (displayName: string): string => {
  const parts = displayName.trim().split(/\s+/u).filter((part) => part.length > 0);
  const letters = parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase());
  const initials = letters.join('');
  return initials.length > 0 ? initials : '?';
};

@Component({
  selector: 'app-chats',
  standalone: true,
  imports: [RouterLink, MatButtonModule, TranslocoPipe],
  templateUrl: './chats.html',
})
export class ChatsPageComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly activeTeam = inject(ActiveTeamService);
  private readonly modal = inject(ModalService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  readonly teamId = this.activeTeam.teamId;
  readonly teamGroups = signal<{ labelKey: string; items: ChatSummary[] }[]>([]);
  readonly privateChats = signal<ChatSummary[]>([]);
  readonly onATeam = signal(false);
  /** Whether the active-team role may create channels. */
  readonly canCreateChannel = signal(false);

  constructor() {
    effect(() => {
      const id = this.teamId();
      untracked(() => {
        void this.load(id);
      });
    });
  }

  ngOnInit(): void {
    if (this.activeTeam.teams().length === 0) void this.activeTeam.refresh();
  }

  /** Opens the add-chat chooser, then the matching create form. */
  async startAdd(): Promise<void> {
    const choice = await this.modal.open<'private' | 'channel'>(AddChatChooserComponent, {
      title: this.transloco.translate('chats.add'),
      inputs: { canCreateChannel: this.canCreateChannel() },
    });
    if (choice === 'private') {
      const chatId = await this.modal.open<string>(CreatePrivateChatComponent, {
        title: this.transloco.translate('chats.newPrivate'),
      });
      if (chatId !== undefined) {
        await this.load(this.teamId());
        await this.router.navigate(['/chats', chatId]);
      }
      return;
    }
    if (choice === 'channel') {
      const teamId = this.teamId();
      if (teamId === undefined) return;
      const chatId = await this.modal.open<string>(CreateChannelComponent, {
        title: this.transloco.translate('chats.newChannel'),
        inputs: { teamId },
      });
      if (chatId !== undefined) {
        await this.load(teamId);
        await this.router.navigate(['/chats', chatId]);
      }
    }
  }

  /**
   * Reloads chats scoped to the active team, plus all private chats.
   *
   * @param activeTeamId - The selected team id, when any.
   */
  private async load(activeTeamId: string | undefined): Promise<void> {
    const chats = await this.api.listChats();
    const onTeam = activeTeamId !== undefined;
    this.onATeam.set(onTeam);
    this.teamGroups.set(
      onTeam
        ? [
            {
              labelKey: 'chats.team',
              items: chats.filter(
                (c) => c.kind === 'default' && c.teamId === activeTeamId,
              ),
            },
            {
              labelKey: 'chats.channels',
              items: chats.filter(
                (c) => c.kind === 'channel' && c.teamId === activeTeamId,
              ),
            },
          ]
        : [],
    );
    this.privateChats.set(chats.filter((c) => c.kind === 'private'));
    await this.loadChannelPermission(activeTeamId);
  }

  /**
   * Sets whether the caller may create channels on the active team.
   *
   * @param teamId - The active team id.
   */
  private async loadChannelPermission(teamId: string | undefined): Promise<void> {
    if (teamId === undefined) {
      this.canCreateChannel.set(false);
      return;
    }
    const role = this.activeTeam.active()?.role;
    if (role === undefined) {
      this.canCreateChannel.set(false);
      return;
    }
    try {
      const body = await this.api.getPermissions(teamId);
      const permissions =
        body.roles.find((entry) => entry.role === role)?.permissions ?? [];
      this.canCreateChannel.set(permissions.includes('create_team_channels'));
    } catch {
      this.canCreateChannel.set(false);
    }
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
    TranslocoPipe,
  ],
  templateUrl: './chat-thread.html',
})
export class ChatThreadPageComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly live = inject(LiveSocketService);

  readonly messages = signal<ChatMessage[]>([]);
  /** Title shown in the thread header. */
  readonly chatName = signal('');
  /** Message whose sender and time are visible. */
  readonly revealedMessageId = signal<string | null>(null);
  /** Download URLs keyed by profile photo object key. */
  readonly photoUrls = signal<Record<string, string>>({});
  /** Download URLs keyed by chat attachment object key. */
  readonly attachmentUrls = signal<Record<string, string>>({});
  /** Images uploaded and waiting to send with the next message. */
  readonly pendingAttachments = signal<PendingAttachment[]>([]);
  readonly uploading = signal(false);
  readonly attachError = signal<string | undefined>(undefined);
  readonly maxAttachments = MAX_ATTACHMENTS;
  draft = '';
  private chatId = '';
  /** Photo keys already being resolved, so a live message does not fetch twice. */
  private readonly photoLoads = new Set<string>();
  /** Attachment keys already being resolved. */
  private readonly attachmentLoads = new Set<string>();

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
   * Returns a display URL for a chat image attachment.
   *
   * @param key - The media object key.
   * @returns The download URL once presigned, otherwise `undefined`.
   */
  attachmentUrl(key: string): string | undefined {
    return this.attachmentUrls()[key];
  }

  /**
   * Uploads a chosen image and queues it for the next send.
   *
   * @param event - The file input change event.
   */
  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    if (this.pendingAttachments().length >= MAX_ATTACHMENTS) return;
    if (!PHOTO_TYPES.has(file.type)) {
      this.attachError.set('errors.profile.badImageType');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      this.attachError.set('errors.profile.imageTooLarge');
      return;
    }
    this.attachError.set(undefined);
    this.uploading.set(true);
    try {
      const presign = await this.api.presignUpload(file.type, file.size);
      const uploaded = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploaded.ok) throw new Error('upload_failed');
      const previewUrl = URL.createObjectURL(file);
      this.pendingAttachments.update((list) => [
        ...list,
        { key: presign.objectKey, previewUrl },
      ]);
      this.attachmentUrls.update((current) => ({
        ...current,
        [presign.objectKey]: previewUrl,
      }));
    } catch {
      this.attachError.set('chats.attachFailed');
    } finally {
      this.uploading.set(false);
    }
  }

  /**
   * Drops a queued image before send.
   *
   * @param key - The uploaded object key to remove.
   */
  removePending(key: string): void {
    const removed = this.pendingAttachments().find((item) => item.key === key);
    if (removed !== undefined) URL.revokeObjectURL(removed.previewUrl);
    this.pendingAttachments.update((list) => list.filter((item) => item.key !== key));
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
    void this.loadAttachmentUrls([message]);
  }

  private async load(): Promise<void> {
    const [page] = await Promise.all([this.api.listMessages(this.chatId), this.loadChatName()]);
    this.messages.set(page.messages);
    await Promise.all([
      this.loadSenderPhotos(page.messages),
      this.loadAttachmentUrls(page.messages),
    ]);
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
   * Presigns chat image attachments that are not already on screen.
   *
   * @param messages - Messages that may include attachment keys.
   */
  private async loadAttachmentUrls(messages: readonly ChatMessage[]): Promise<void> {
    const keys = new Set<string>();
    for (const message of messages) {
      for (const key of message.attachmentKeys ?? []) {
        keys.add(key);
      }
    }
    const pending: string[] = [];
    for (const key of keys) {
      if (this.attachmentUrls()[key] !== undefined || this.attachmentLoads.has(key)) continue;
      this.attachmentLoads.add(key);
      pending.push(key);
    }
    await Promise.all(
      pending.map(async (key) => {
        try {
          const download = await this.api.presignDownload(key);
          this.attachmentUrls.update((current) => ({
            ...current,
            [key]: download.downloadUrl,
          }));
        } catch {
          // The bubble stays without that image when download cannot be signed.
        } finally {
          this.attachmentLoads.delete(key);
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
    if (this.uploading()) return;
    const body = this.draft.trim();
    const attachmentKeys = this.pendingAttachments().map((item) => item.key);
    if (body.length === 0 && attachmentKeys.length === 0) return;
    this.draft = '';
    for (const item of this.pendingAttachments()) {
      URL.revokeObjectURL(item.previewUrl);
    }
    this.pendingAttachments.set([]);
    const message = await this.api.sendMessage(this.chatId, {
      body,
      ...(attachmentKeys.length > 0 ? { attachmentKeys } : {}),
    });
    this.upsertMessage(message);
  }
}

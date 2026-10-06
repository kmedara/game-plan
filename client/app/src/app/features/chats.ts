/**
 * Chat list and message thread screens.
 */

import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  ApiClient,
  type ChatMessage,
  type ChatSummary,
} from '../core/api-client';
import { LiveSocket } from '../core/live-socket';

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
            { label: 'Team default', items: chats.filter((c) => c.kind === 'default') },
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
  ],
  templateUrl: './chat-thread.html',
})
export class ChatThreadPageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);
  private readonly live = inject(LiveSocket);

  readonly messages = signal<ChatMessage[]>([]);
  draft = '';
  private chatId = '';

  ngOnInit(): void {
    this.chatId = this.route.snapshot.paramMap.get('chatId') ?? '';
    void this.load();
    this.live.subscribe((event) => {
      if (event.type === 'chat_message' && event.chatId === this.chatId) {
        this.messages.update((list) => [
          {
            messageId: event.messageId,
            chatId: event.chatId,
            senderId: event.senderId,
            body: event.body,
            attachmentKeys: event.attachmentKeys,
            createdAt: event.createdAt,
          },
          ...list.filter((m) => m.messageId !== event.messageId),
        ]);
      }
    });
  }

  private async load(): Promise<void> {
    const page = await this.api.listMessages(this.chatId);
    this.messages.set(page.messages);
  }

  async send(): Promise<void> {
    const body = this.draft.trim();
    if (body.length === 0) return;
    this.draft = '';
    const message = await this.api.sendMessage(this.chatId, body);
    this.messages.update((list) => [message, ...list]);
  }
}

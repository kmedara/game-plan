/**
 * Exact-email search and private chat creation.
 */

import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoPipe } from '@jsverse/transloco';
import type { UserProfile } from '@gameplan/types';
import { ApiClientService } from '../core/api-client.service';
import { ModalRef } from '../core/modal.service';

@Component({
  selector: 'app-create-private-chat',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, TranslocoPipe],
  templateUrl: './create-private-chat.html',
  styles: [
    `
      mat-form-field {
        width: 100%;
      }
    `,
  ],
})
export class CreatePrivateChatComponent {
  private readonly api = inject(ApiClientService);
  private readonly modal = inject(ModalRef<string>);

  email = '';
  readonly match = signal<UserProfile | undefined>(undefined);
  readonly searching = signal(false);
  readonly creating = signal(false);
  readonly error = signal<string | undefined>(undefined);

  /** Looks up an adult by exact email. */
  async search(): Promise<void> {
    const email = this.email.trim();
    this.error.set(undefined);
    this.match.set(undefined);
    if (email.length === 0) {
      this.error.set('chats.emailRequired');
      return;
    }
    this.searching.set(true);
    try {
      const user = await this.api.searchChatUser(email);
      if (user.userId === this.api.user?.userId) {
        this.error.set('chats.cannotChatSelf');
        return;
      }
      this.match.set(user);
    } catch (err) {
      this.error.set(
        err instanceof Error && err.message === 'user_not_found'
          ? 'chats.userNotFound'
          : 'chats.searchFailed',
      );
    } finally {
      this.searching.set(false);
    }
  }

  /** Creates the private chat and returns its id to the opener. */
  async create(): Promise<void> {
    const user = this.match();
    if (user === undefined || this.creating()) return;
    this.creating.set(true);
    this.error.set(undefined);
    try {
      const chat = await this.api.createPrivateChat([user.userId]);
      this.modal.close(chat.chatId);
    } catch {
      this.error.set('chats.createFailed');
    } finally {
      this.creating.set(false);
    }
  }
}

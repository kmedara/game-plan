/**
 * Named team channel creation for the active team.
 */

import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiClientService } from '../core/api-client.service';
import { ModalRef } from '../core/modal.service';

@Component({
  selector: 'app-create-channel',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, TranslocoPipe],
  templateUrl: './create-channel.html',
  styles: [
    `
      mat-form-field {
        width: 100%;
      }
    `,
  ],
})
export class CreateChannelComponent {
  private readonly api = inject(ApiClientService);
  private readonly modal = inject(ModalRef<string>);

  /** Active team that will own the channel. */
  readonly teamId = input.required<string>();

  name = '';
  readonly creating = signal(false);
  readonly error = signal<string | undefined>(undefined);

  /** Creates the channel and returns its id to the opener. */
  async create(): Promise<void> {
    const name = this.name.trim();
    if (name.length === 0) {
      this.error.set('chats.channelNameRequired');
      return;
    }
    if (this.creating()) return;
    this.creating.set(true);
    this.error.set(undefined);
    try {
      const chat = await this.api.createTeamChannel(this.teamId(), name);
      this.modal.close(chat.chatId);
    } catch {
      this.error.set('chats.createFailed');
    } finally {
      this.creating.set(false);
    }
  }
}

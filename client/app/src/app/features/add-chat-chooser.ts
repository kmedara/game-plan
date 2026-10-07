/**
 * Chooser for starting a private chat or a team channel.
 */

import { Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoPipe } from '@jsverse/transloco';
import { ModalRef } from '../core/modal.service';

/** Result returned when the user picks a create path. */
export type AddChatChoice = 'private' | 'channel';

@Component({
  selector: 'app-add-chat-chooser',
  standalone: true,
  imports: [MatButtonModule, TranslocoPipe],
  template: `
    <div class="stack">
      <button mat-stroked-button type="button" (click)="pick('private')">
        {{ 'chats.newPrivate' | transloco }}
      </button>
      @if (canCreateChannel()) {
        <button mat-stroked-button type="button" (click)="pick('channel')">
          {{ 'chats.newChannel' | transloco }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      button {
        width: 100%;
      }
    `,
  ],
})
export class AddChatChooserComponent {
  private readonly modal = inject(ModalRef<AddChatChoice>);

  /** When false, only the private-chat option is shown. */
  readonly canCreateChannel = input(false);

  /**
   * Closes the chooser with the selected path.
   *
   * @param choice - Private chat or team channel.
   */
  pick(choice: AddChatChoice): void {
    this.modal.close(choice);
  }
}

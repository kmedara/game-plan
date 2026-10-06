/**
 * Completes birthday (and display name) after first social Hosted UI sign-in.
 */

import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiClientService } from '../core/api-client.service';

@Component({
  selector: 'app-complete-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './complete-profile.html',
})
export class CompleteProfilePageComponent {
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);

  readonly form = this.fb.nonNullable.group({
    displayName: [this.api.user?.displayName ?? '', [Validators.required]],
    birthday: ['', [Validators.required]],
  });

  /** Saves birthday and opens teams. */
  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set(undefined);
    const value = this.form.getRawValue();

    await this.api
      .completeProfile({
        birthday: value.birthday,
        displayName: value.displayName,
      })
      .then(() => this.router.navigateByUrl('/teams'))
      .catch((err) =>
        this.error.set(err instanceof Error ? err.message : 'request_failed'),
      )
      .finally(() => this.busy.set(false));
    // try {
    //   await this.api.completeProfile({
    //     birthday: value.birthday,
    //     displayName: value.displayName,
    //   });
    //   await this.router.navigateByUrl('/teams');
    // } catch (err) {
    //   this.error.set(err instanceof Error ? err.message : 'request_failed');
    // } finally {
    //   this.busy.set(false);
    // }
  }
}

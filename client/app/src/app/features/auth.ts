/**
 * Login screen — Cognito Hosted UI redirect, or seed session when AUTH_DISABLED.
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ApiClientService } from '../core/api-client.service';
import { environment } from '../../environments/environment';
import { LiveSocketService } from '../core/live-socket.service';
import { PushRegistrationService } from '../core/push-registration.service';

/**
 * Login URL for Cognito Hosted UI through the identity BFF.
 *
 * @param origin - The app origin used to build the post-login return URL.
 * @returns The absolute login URL.
 */
export const hostedUiLoginHref = (origin: string): string => {
  const returnTo = encodeURIComponent(`${origin}/teams`);
  return `${environment.apiBaseUrl}/identity/oauth/login?returnTo=${returnTo}`;
};

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [MatButtonModule],
  templateUrl: './auth.html',
})
export class AuthPageComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly live = inject(LiveSocketService);
  private readonly push = inject(PushRegistrationService);

  readonly authDisabled = environment.authDisabled;
  readonly seedUserEmail = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);

  ngOnInit(): void {
    const error = this.route.snapshot.queryParamMap.get('error');
    if (error) this.error.set(error);
    if (this.authDisabled) void this.loadSeedUser();
  }

  /** Starts Cognito Hosted UI through the identity BFF. */
  startHostedUi(): void {
    window.location.href = hostedUiLoginHref(window.location.origin);
  }

  /** Issues the seed session when auth is disabled. */
  async continueLocal(): Promise<void> {
    this.busy.set(true);
    this.error.set(undefined);
    try {
      const ok = await this.api.refreshSession();
      if (!ok) throw new Error('seed_session_failed');
      this.seedUserEmail.set(this.api.user?.email ?? '');
      const token = this.api.accessToken();
      if (token !== undefined) this.live.connect(token);
      void this.push.register();
      await this.router.navigateByUrl('/teams');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'request_failed');
    } finally {
      this.busy.set(false);
    }
  }

  /** Loads the seed profile so the Continue label can show the email. */
  private async loadSeedUser(): Promise<void> {
    const ok = await this.api.refreshSession();
    if (!ok) return;
    this.seedUserEmail.set(this.api.user?.email ?? '');
  }
}

/**
 * Root application: session bootstrap and the top-level router outlet.
 */

import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ActiveTeamService } from './core/active-team.service';
import { ApiClientService } from './core/api-client.service';
import { LiveSocketService } from './core/live-socket.service';
import { PushRegistrationService } from './core/push-registration.service';
import { ThemePreferenceService } from './core/theme-preference.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly activeTeam = inject(ActiveTeamService);
  private readonly live = inject(LiveSocketService);
  private readonly push = inject(PushRegistrationService);
  private readonly theme = inject(ThemePreferenceService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    void this.theme.restore();
    void this.bootstrapSession();
  }

  /** Tries cookie/Preferences refresh so a reload stays signed in. */
  private async bootstrapSession(): Promise<void> {
    if (this.api.isAuthenticated()) {
      await this.activeTeam.refresh();
      return;
    }
    const ok = await this.api.refreshSession();
    if (!ok) return;
    const user = this.api.user;
    if (user?.needsProfileCompletion) {
      await this.router.navigateByUrl('/complete-profile');
      return;
    }
    const token = this.api.accessToken();
    if (token !== undefined) this.live.connect(token);
    void this.push.register();
    await this.activeTeam.refresh();
  }
}

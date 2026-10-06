/**
 * Root application shell with bottom navigation for authenticated routes.
 *
 * Schedule and Chats only appear in the nav when the user belongs to a team.
 */

import { Component, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiClient } from './core/api-client';
import { LiveSocket } from './core/live-socket';
import { PushRegistration } from './core/push-registration';
import { TeamBrand } from './core/team-brand';
import { ThemePreference } from './core/theme';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  readonly api = inject(ApiClient);
  private readonly live = inject(LiveSocket);
  private readonly push = inject(PushRegistration);
  private readonly theme = inject(ThemePreference);
  private readonly teamBrand = inject(TeamBrand);
  private readonly router = inject(Router);

  showNav = false;

  ngOnInit(): void {
    void this.theme.restore();
    void this.bootstrapSession();
    this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      this.showNav = this.api.isAuthenticated() && !this.isAuthPath(event.urlAfterRedirects);
    });
  }

  /** Tries cookie/Preferences refresh so a reload stays signed in. */
  private async bootstrapSession(): Promise<void> {
    if (this.api.isAuthenticated()) {
      await this.refreshTeamMembership();
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
    await this.refreshTeamMembership();
    this.showNav = !this.isAuthPath(this.router.url);
  }

  /** Loads teams and applies the selected team's colors for every page. */
  private async refreshTeamMembership(): Promise<void> {
    try {
      const teams = await this.api.listTeams();
      await this.api.restoreTeamId();
      const selected =
        teams.find((team) => team.teamId === this.api.getTeamId()) ?? teams[0];
      if (selected === undefined) {
        this.api.setTeamId(undefined);
        await this.teamBrand.apply(undefined);
        return;
      }
      this.api.setTeamId(selected.teamId);
      await this.teamBrand.apply(selected.theme);
    } catch {
      this.api.hasTeams.set(false);
    }
  }

  private isAuthPath(url: string): boolean {
    return (
      url.startsWith('/login') ||
      url.startsWith('/register') ||
      url.startsWith('/complete-profile')
    );
  }
}

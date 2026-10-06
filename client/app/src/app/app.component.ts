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
  private readonly router = inject(Router);

  showNav = false;

  ngOnInit(): void {
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

  /** Loads team membership so schedule/chat nav can stay hidden until the user joins. */
  private async refreshTeamMembership(): Promise<void> {
    try {
      await this.api.listTeams();
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

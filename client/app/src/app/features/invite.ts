/**
 * Accept a shared team invite code.
 */

import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import type { InvitePreview } from '@gameplan/types';
import { ApiClientService } from '../core/api-client.service';
import { ActiveTeamService } from '../core/active-team.service';
import { roleLabel } from './teams';

/**
 * Sentence for a failed invite lookup or accept.
 *
 * @param err - The error from the API client.
 * @returns A message for the invite page.
 */
export const inviteErrorMessage = (err: unknown): string => {
  const code = err instanceof Error ? err.message : '';
  switch (code) {
    case 'not_found':
      return 'That invite link is not valid.';
    case 'already_a_member':
      return 'You are already on this team.';
    case 'minor_cannot_be_team_admin':
    case 'minor_cannot_hold_manage_permissions':
      return 'This invite role is not available for your account.';
    case 'forbidden':
      return 'You cannot use this invite.';
    default:
      return 'Could not use this invite.';
  }
};

@Component({
  selector: 'app-invite',
  standalone: true,
  imports: [RouterLink, MatButtonModule],
  templateUrl: './invite.html',
})
export class InvitePageComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly activeTeam = inject(ActiveTeamService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly roleLabel = roleLabel;
  readonly preview = signal<InvitePreview | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly joining = signal(false);
  private code = '';

  ngOnInit(): void {
    this.code = this.route.snapshot.paramMap.get('code') ?? '';
    void this.load();
  }

  /** Loads the team and role for the code in the URL. */
  private async load(): Promise<void> {
    if (this.code.length === 0) {
      this.error.set(inviteErrorMessage(new Error('not_found')));
      return;
    }
    try {
      this.preview.set(await this.api.getInvite(this.code));
    } catch (err) {
      this.error.set(inviteErrorMessage(err));
    }
  }

  /** Joins the team and opens the schedule. */
  async accept(): Promise<void> {
    if (this.joining() || this.code.length === 0) return;
    this.joining.set(true);
    this.error.set(undefined);
    try {
      const membership = await this.api.acceptInvite(this.code);
      await this.activeTeam.refresh();
      await this.activeTeam.select(membership.teamId);
      await this.router.navigateByUrl('/schedule');
    } catch (err) {
      this.error.set(inviteErrorMessage(err));
      this.joining.set(false);
    }
  }
}

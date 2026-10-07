/**
 * Read-only profile for a teammate opened from the roster.
 */

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { MatButtonModule } from '@angular/material/button';
import type { TeamMemberProfile } from '@gameplan/types';
import { ApiClientService } from '../core/api-client.service';
import { roleLabel } from './teams';

/**
 * Initials shown when the member has no photo.
 *
 * @param displayName - The member display name.
 * @returns Up to two uppercase letters.
 */
const initialsOf = (displayName: string): string => {
  const parts = displayName.trim().split(/\s+/u).filter((part) => part.length > 0);
  const letters = parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase());
  const initials = letters.join('');
  return initials.length > 0 ? initials : '?';
};

@Component({
  selector: 'app-member-profile',
  standalone: true,
  imports: [RouterLink, MatButtonModule, TranslocoPipe],
  templateUrl: './member-profile.html',
})
export class MemberProfilePageComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly teamId = this.route.snapshot.paramMap.get('teamId') ?? '';
  readonly member = signal<TeamMemberProfile | undefined>(undefined);
  readonly photoUrl = signal<string | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly roleLabel = roleLabel;
  readonly initials = computed(() =>
    initialsOf(this.member()?.displayName ?? ''),
  );

  ngOnInit(): void {
    void this.load();
  }

  /** Loads the member and their photo when present. */
  private async load(): Promise<void> {
    const userId = this.route.snapshot.paramMap.get('userId') ?? '';
    if (this.teamId.length === 0 || userId.length === 0) {
      this.error.set('errors.memberProfile.notFound');
      return;
    }

    if (this.api.user?.userId === userId) {
      await this.router.navigateByUrl('/profile');
      return;
    }

    try {
      const member = await this.api.getMember(this.teamId, userId);
      this.member.set(member);
      if (member.photoKey !== undefined) {
        const download = await this.api.presignDownload(member.photoKey);
        this.photoUrl.set(download.downloadUrl);
      }
    } catch {
      this.error.set('errors.memberProfile.loadFailed');
    }
  }
}

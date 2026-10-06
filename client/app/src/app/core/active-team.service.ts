/**
 * App-wide selected team list and switcher state.
 *
 * Branding and the persisted team id update together via {@link select}.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import type { TeamSummary } from '@gameplan/types';
import { ApiClientService } from './api-client.service';
import { TeamBrandService } from './team-brand.service';

@Injectable({ providedIn: 'root' })
export class ActiveTeamService {
  private readonly api = inject(ApiClientService);
  private readonly brand = inject(TeamBrandService);

  /** Memberships available in the team switcher. */
  readonly teams = signal<TeamSummary[]>([]);

  /** Active team id from {@link ApiClientService}. */
  readonly teamId = computed(() => this.api.selectedTeamId());

  /** Summary for the active team, when it is in {@link teams}. */
  readonly active = computed(
    () => this.teams().find((team) => team.teamId === this.teamId()),
  );

  /**
   * Reloads memberships and selects a valid team (or clears branding).
   */
  async refresh(): Promise<void> {
    const teams = await this.api.listTeams();
    this.teams.set(teams);
    await this.api.restoreTeamId();
    const selected =
      teams.find((team) => team.teamId === this.api.getTeamId()) ?? teams[0];
    if (selected === undefined) {
      await this.brand.clear();
      return;
    }
    if (this.api.getTeamId() !== selected.teamId) {
      await this.brand.select(selected.teamId, selected.theme);
    }
    for (const team of teams) void this.brand.rememberLogo(team.theme?.logoKey);
  }

  /**
   * Switches the active team and applies its brand app-wide.
   *
   * @param teamId - The team to select.
   */
  async select(teamId: string): Promise<void> {
    if (this.api.getTeamId() === teamId) return;
    const theme = this.teams().find((team) => team.teamId === teamId)?.theme;
    await this.brand.select(teamId, theme);
  }

  /** Clears memberships, the selected team, and branding. */
  async clear(): Promise<void> {
    this.teams.set([]);
    await this.brand.clear();
  }
}

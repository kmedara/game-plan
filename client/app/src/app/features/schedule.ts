/**
 * Schedule home screen with team switcher and occurrence RSVP.
 */

import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import {
  ApiClient,
  type ScheduleOccurrence,
  type TeamSummary,
} from '../core/api-client';
import { LiveSocket } from '../core/live-socket';

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    RouterLink,
  ],
  templateUrl: './schedule.html',
})
export class SchedulePageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly live = inject(LiveSocket);

  readonly teams = signal<TeamSummary[]>([]);
  readonly teamId = signal<string | undefined>(undefined);
  readonly occurrences = signal<ScheduleOccurrence[]>([]);
  readonly error = signal<string | undefined>(undefined);

  ngOnInit(): void {
    void this.bootstrap();
    this.live.subscribe((event) => {
      if (event.type === 'schedule_changed' && event.teamId === this.teamId()) {
        void this.loadSchedule();
      }
    });
  }

  /** Loads teams and the selected team's schedule window. */
  private async bootstrap(): Promise<void> {
    try {
      const teams = await this.api.listTeams();
      this.teams.set(teams);
      const selected = this.api.getTeamId() ?? teams[0]?.teamId;
      if (selected !== undefined) {
        this.api.setTeamId(selected);
        this.teamId.set(selected);
        await this.loadSchedule();
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'load_failed');
    }
  }

  /**
   * Switches the active team and reloads occurrences.
   *
   * @param teamId - The selected team id.
   */
  async onTeamChange(teamId: string): Promise<void> {
    this.api.setTeamId(teamId);
    this.teamId.set(teamId);
    await this.loadSchedule();
  }

  /** Loads a one-month schedule window for the selected team. */
  private async loadSchedule(): Promise<void> {
    const teamId = this.teamId();
    if (teamId === undefined) return;
    const from = new Date();
    const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
    try {
      const result = await this.api.getSchedule(
        teamId,
        from.toISOString(),
        to.toISOString(),
      );
      this.occurrences.set(result.occurrences);
      this.error.set(undefined);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'load_failed');
    }
  }

  /**
   * Upserts an RSVP for one occurrence.
   *
   * @param item - The occurrence row.
   * @param status - going / maybe / not_going.
   */
  async rsvp(item: ScheduleOccurrence, status: string): Promise<void> {
    const teamId = this.teamId();
    if (teamId === undefined) return;
    try {
      await this.api.putRsvp(teamId, {
        eventId: item.eventId,
        occurrenceStartsAt: item.startsAt,
        status,
      });
      await this.loadSchedule();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'rsvp_failed');
    }
  }

  /**
   * Returns the caller's RSVP status for an occurrence.
   *
   * @param item - The occurrence row.
   * @returns Status string, or `none`.
   */
  myRsvp(item: ScheduleOccurrence): string {
    const userId = this.api.user?.userId;
    if (userId === undefined) return 'none';
    return item.rsvps.find((entry) => entry.userId === userId)?.status ?? 'none';
  }
}

/**
 * Modal showing one schedule occurrence: time, place, RSVP, and who replied.
 */

import { Component, OnInit, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Capacitor } from '@capacitor/core';
import { MatButtonModule } from '@angular/material/button';
import {
  type RsvpStatus,
  type ScheduleOccurrence,
} from '@gameplan/types';
import { ApiClientService } from '../core/api-client.service';
import { ModalRef } from '../core/modal.service';
import { eventTypeLabel } from './add-event-form';
import { openPlaceInMaps, type MapsProvider } from './place-search';
import { clockLabel, dayKeyInZone, dayTitle } from './schedule-calendar';

@Component({
  selector: 'app-event-detail',
  standalone: true,
  imports: [MatButtonModule, TranslocoPipe],
  templateUrl: './event-detail.html',
})
export class EventDetailComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly modal = inject(ModalRef<boolean>);
  private readonly transloco = inject(TranslocoService);

  /** Occurrence to display. */
  readonly occurrence = input.required<ScheduleOccurrence>();

  /** Team that owns the event. */
  readonly teamId = input.required<string>();

  /** IANA zone for wall-clock labels. */
  readonly timeZone = input.required<string>();

  readonly rsvpStatuses = ['going', 'maybe', 'not_going'] as const satisfies readonly RsvpStatus[];
  readonly item = signal<ScheduleOccurrence | undefined>(undefined);
  readonly memberNames = signal<Map<string, string>>(new Map());
  readonly error = signal<string | undefined>(undefined);
  private changed = false;

  ngOnInit(): void {
    this.item.set(structuredClone(this.occurrence()));
    void this.loadMembers();
  }

  /** Localized event type label key. */
  eventLabel(eventType: string): string {
    return eventTypeLabel(eventType);
  }

  /** Wall date heading for the occurrence. */
  dayLabel(): string {
    const item = this.item();
    if (item === undefined) return '';
    const key = dayKeyInZone(new Date(item.startsAt), this.timeZone());
    return dayTitle(key, this.timeZone());
  }

  /**
   * Clock time of an instant in the team zone.
   *
   * @param iso - A UTC ISO instant.
   * @returns A short clock time.
   */
  timeLabel(iso: string): string {
    return clockLabel(iso, this.timeZone());
  }

  /**
   * Returns the caller's RSVP status for the open occurrence.
   *
   * @returns Status string, or `none`.
   */
  myRsvp(): string {
    const item = this.item();
    const userId = this.api.user?.userId;
    if (item === undefined || userId === undefined) return 'none';
    const rsvps = Array.isArray(item.rsvps) ? item.rsvps : [];
    return rsvps.find((entry) => entry.userId === userId)?.status ?? 'none';
  }

  /**
   * Transloco key for an RSVP choice button.
   *
   * @param status - going / maybe / not_going.
   * @returns The i18n key for the button label.
   */
  rsvpChoiceKey(status: RsvpStatus): string {
    if (status === 'going') return 'schedule.going';
    if (status === 'maybe') return 'schedule.maybe';
    return 'schedule.notGoing';
  }

  /**
   * Display names for everyone who picked a status.
   *
   * @param status - going / maybe / not_going.
   * @returns Names for that RSVP bucket.
   */
  namesFor(status: RsvpStatus): string[] {
    const item = this.item();
    if (item === undefined) return [];
    const rsvps = Array.isArray(item.rsvps) ? item.rsvps : [];
    const names = this.memberNames();
    return rsvps
      .filter((entry) => entry.status === status)
      .map(
        (entry) =>
          names.get(entry.userId) ??
          this.transloco.translate('common.unknownPerson'),
      )
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Upserts the caller's RSVP and updates the local occurrence.
   *
   * @param status - going / maybe / not_going.
   */
  async rsvp(status: RsvpStatus): Promise<void> {
    const item = this.item();
    const teamId = this.teamId();
    const userId = this.api.user?.userId;
    if (item === undefined || userId === undefined) return;
    if (this.myRsvp() === status) return;
    try {
      await this.api.putRsvp(teamId, {
        eventId: item.eventId,
        occurrenceStartsAt: item.startsAt,
        status,
      });
      const others = (Array.isArray(item.rsvps) ? item.rsvps : []).filter(
        (entry) => entry.userId !== userId,
      );
      this.item.set({
        ...item,
        rsvps: [...others, { userId, status }],
      });
      this.changed = true;
      this.error.set(undefined);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'rsvp_failed');
    }
  }

  primaryMapsProvider(): MapsProvider {
    return Capacitor.getPlatform() === 'ios' ? 'apple' : 'google';
  }

  showSecondaryMapsLink(): boolean {
    const platform = Capacitor.getPlatform();
    return platform === 'ios' || platform === 'web';
  }

  secondaryMapsProvider(): MapsProvider {
    return this.primaryMapsProvider() === 'apple' ? 'google' : 'apple';
  }

  mapsProviderLabel(provider: MapsProvider): string {
    return provider === 'apple' ? 'maps.apple' : 'maps.google';
  }

  /**
   * Opens the occurrence location in a maps app.
   *
   * @param provider - Apple Maps or Google Maps.
   */
  openMaps(provider: MapsProvider): void {
    const item = this.item();
    if (item === undefined || item.location === undefined || item.location.length === 0) {
      return;
    }
    openPlaceInMaps(
      {
        label: item.location,
        ...(item.latitude !== undefined ? { latitude: item.latitude } : {}),
        ...(item.longitude !== undefined ? { longitude: item.longitude } : {}),
      },
      provider,
    );
  }

  /** Closes the dialog; true when the schedule should reload. */
  close(): void {
    this.modal.close(this.changed);
  }

  private async loadMembers(): Promise<void> {
    try {
      const members = await this.api.listMembers(this.teamId());
      const names = new Map<string, string>();
      for (const member of members) {
        const label =
          member.displayName?.trim() ||
          member.email?.trim() ||
          this.transloco.translate('common.unknownPerson') || '';
        names.set(member.userId, label);
      }
      this.memberNames.set(names);
    } catch {
      this.memberNames.set(new Map());
    }
  }
}

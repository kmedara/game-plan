/**
 * Form for adding a practice, game, meeting, or other event on one day.
 */

import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { EVENT_TYPES, type EventType, type RecurrenceRule } from '@gameplan/types';
import { ApiClient } from '../core/api-client';
import { ModalRef } from '../core/modal';
import { RRULE_WEEKDAYS, rruleWeekDay, wallTimeToIso } from './schedule-calendar';

/** Display names for the event type picker. */
const EVENT_TYPE_LABELS: Record<EventType, string> = {
  practice: 'Practice',
  game: 'Game',
  meeting: 'Meeting',
  fundraiser: 'Fundraiser',
  other: 'Other',
};

/**
 * Display name for an event type.
 *
 * @param eventType - The stored event type.
 * @returns The label shown on the picker and event cards.
 */
export const eventTypeLabel = (eventType: string): string => {
  if (eventType in EVENT_TYPE_LABELS) return EVENT_TYPE_LABELS[eventType as EventType];
  return eventType;
};

/** `rrule` `FREQ` values, plus a one-off that stores no recurrence rule. */
const FREQUENCIES = [
  { value: 'ONCE', label: 'Does not repeat' },
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY', label: 'Yearly' },
] as const;

/** Full weekday names, Sunday first, aligned with {@link rruleWeekDay}. */
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

type RepeatFrequency = (typeof FREQUENCIES)[number]['value'];

@Component({
  selector: 'app-add-event-form',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  templateUrl: './add-event-form.html',
  styles: [
    `
      mat-form-field {
        width: 100%;
      }
    `,
  ],
})
export class AddEventFormComponent {
  private readonly api = inject(ApiClient);
  private readonly modal = inject(ModalRef<boolean>);

  /** Team that will own the event. */
  readonly teamId = input.required<string>();

  /** `YYYY-MM-DD` wall date the event is added to. */
  readonly dayKey = input.required<string>();

  /** IANA time zone used to turn the clock times into instants. */
  readonly timeZone = input.required<string>();

  /** Heading for the selected day, shown above the fields. */
  readonly dayLabel = input('');

  readonly eventTypes = EVENT_TYPES;
  readonly eventTypeLabel = eventTypeLabel;
  readonly frequencies = FREQUENCIES;
  readonly saving = signal(false);
  readonly error = signal<string | undefined>(undefined);

  draftType: EventType = 'practice';
  draftTitle = '';
  draftStart = '18:00';
  draftEnd = '19:30';
  draftLocation = '';
  draftFrequency: RepeatFrequency = 'ONCE';
  draftInterval = 1;

  /**
   * Plain-language reading of the `rrule` frequency and interval.
   *
   * @returns Empty when the event does not repeat.
   */
  repeatSummary(): string {
    if (this.draftFrequency === 'ONCE') return '';
    const interval = this.intervalCount();
    const unit = this.intervalUnit(interval);
    const every = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}`;
    if (this.draftFrequency !== 'WEEKLY') return every;
    const weekday = WEEKDAY_NAMES[RRULE_WEEKDAYS.indexOf(rruleWeekDay(this.dayKey()))];
    return weekday === undefined ? every : `${every} on ${weekday}`;
  }

  /** Closes the dialog without creating an event. */
  cancel(): void {
    this.modal.close(false);
  }

  /** Creates the event and closes the dialog when the save succeeds. */
  async submit(): Promise<void> {
    const title = this.draftTitle.trim();
    if (title.length === 0 || this.saving()) return;
    if (this.draftEnd.length > 0 && this.draftEnd < this.draftStart) {
      this.error.set('End time is before the start time.');
      return;
    }

    const recurrence = this.recurrence();
    if (recurrence === 'invalid') {
      this.error.set('Interval must be at least 1.');
      return;
    }

    const zone = this.timeZone();
    const key = this.dayKey();
    this.saving.set(true);
    this.error.set(undefined);
    try {
      const location = this.draftLocation.trim();
      await this.api.createEvent(this.teamId(), {
        eventType: this.draftType,
        title,
        startsAt: wallTimeToIso(zone, key, this.draftStart),
        ...(this.draftEnd.length > 0 ? { endsAt: wallTimeToIso(zone, key, this.draftEnd) } : {}),
        ...(location.length > 0 ? { location } : {}),
        ...(recurrence !== undefined ? { recurrence } : {}),
      });
      this.modal.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'create_failed');
      this.saving.set(false);
    }
  }

  /**
   * Builds the stored recurrence rule from the frequency controls.
   *
   * A one-off event has no rule. Weekly rules set `BYDAY` to the selected
   * calendar weekday. `interval` is the `rrule` interval.
   *
   * @returns The rule, `undefined` when it does not repeat, or `invalid`.
   */
  private recurrence(): RecurrenceRule | undefined | 'invalid' {
    if (this.draftFrequency === 'ONCE') return undefined;
    const interval = Math.floor(Number(this.draftInterval));
    if (!Number.isFinite(interval) || interval < 1) return 'invalid';
    return {
      frequency: this.draftFrequency,
      interval,
      ...(this.draftFrequency === 'WEEKLY' ? { byWeekDay: [rruleWeekDay(this.dayKey())] } : {}),
    };
  }

  /**
   * Interval used in the summary. Invalid values read as 1 so the sentence stays stable.
   *
   * @returns A positive integer.
   */
  private intervalCount(): number {
    const interval = Math.floor(Number(this.draftInterval));
    return Number.isFinite(interval) && interval >= 1 ? interval : 1;
  }

  /**
   * Unit word for the selected frequency.
   *
   * @param interval - The `rrule` interval.
   * @returns A singular unit for 1, otherwise the plural.
   */
  private intervalUnit(interval: number): string {
    if (this.draftFrequency === 'ONCE') return '';
    const units: Record<RecurrenceRule['frequency'], [string, string]> = {
      DAILY: ['day', 'days'],
      WEEKLY: ['week', 'weeks'],
      MONTHLY: ['month', 'months'],
      YEARLY: ['year', 'years'],
    };
    const [singular, plural] = units[this.draftFrequency];
    return interval === 1 ? singular : plural;
  }
}

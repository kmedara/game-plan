/**
 * Form for adding a practice, game, meeting, or other event on one day.
 */

import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  EVENT_TYPES,
  type EventType,
  type RecurrenceRule,
} from '@gameplan/types';
import { ApiClientService } from '../core/api-client.service';
import { ModalRef } from '../core/modal.service';
import {
  LocationMapComponent,
  PlaceSearchService,
  type MapPick,
  type PlaceSuggestion,
} from './place-search';
import {
  RRULE_WEEKDAYS,
  rruleWeekDay,
  wallTimeToIso,
} from './schedule-calendar';

/** Display names for the event type picker. */
const EVENT_TYPE_LABELS: Record<EventType, string> = {
  practice: 'Practice',
  game: 'Game',
  meeting: 'Meeting',
  other: 'Other',
};

/**
 * Display name for an event type.
 *
 * @param eventType - The stored event type.
 * @returns The label shown on the picker and event cards.
 */
export const eventTypeLabel = (eventType: string): string => {
  if (eventType in EVENT_TYPE_LABELS)
    return EVENT_TYPE_LABELS[eventType as EventType];
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
  imports: [
    FormsModule,
    LocationMapComponent,
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
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
  private readonly api = inject(ApiClientService);
  private readonly modal = inject(ModalRef<boolean>);
  private readonly places = inject(PlaceSearchService);

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
  readonly placeSuggestions = signal<PlaceSuggestion[]>([]);
  readonly mapLatitude = signal<number | undefined>(undefined);
  readonly mapLongitude = signal<number | undefined>(undefined);

  draftType: EventType = 'practice';
  draftTitle = '';
  draftStart = '18:00';
  draftEnd = '19:30';
  draftLocation = '';
  draftLatitude: number | undefined;
  draftLongitude: number | undefined;
  draftFrequency: RepeatFrequency = 'ONCE';
  draftInterval = 1;

  /**
   * Label shown in the location input for typed text or a selected suggestion.
   *
   * @param value - Free text or an autocomplete suggestion.
   * @returns The full text to show in the input.
   */
  displayLocation = (value: string | PlaceSuggestion | null): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (value.secondaryText !== undefined && value.secondaryText.length > 0) {
      return `${value.primaryText}, ${value.secondaryText}`;
    }
    return value.primaryText;
  };

  /**
   * Plain-language reading of the `rrule` frequency and interval.
   *
   * @returns Empty when the event does not repeat.
   */
  repeatSummary(): string {
    if (this.draftFrequency === 'ONCE') return '';
    const interval = this.intervalCount();
    const unit = this.intervalUnit(interval);
    const every =
      interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}`;
    if (this.draftFrequency !== 'WEEKLY') return every;
    const weekday =
      WEEKDAY_NAMES[RRULE_WEEKDAYS.indexOf(rruleWeekDay(this.dayKey()))]!;
    return `${every} on ${weekday}`;
  }

  /**
   * Clears coordinates and refreshes suggestions when the user types.
   *
   * @param value - The current input value from ngModel (string while typing).
   */
  onLocationInput(value: string | PlaceSuggestion): void {
    if (typeof value !== 'string') {
      // Autocomplete briefly sets the option object; ignore until resolve finishes.
      return;
    }
    this.draftLocation = value;
    this.clearCoordinates();
    void this.places.autocomplete(value).then((suggestions) => {
      this.placeSuggestions.set(suggestions);
    });
  }

  /**
   * Resolves a picked suggestion into a full label and coordinates.
   *
   * @param suggestion - The selected autocomplete row.
   */
  async onPlaceSelected(suggestion: PlaceSuggestion): Promise<void> {
    // Keep a readable string in the input while resolve runs (avoids leaving the option object).
    this.draftLocation = this.displayLocation(suggestion);
    try {
      const place = await this.places.resolve(suggestion.id);
      this.applyPlace(place.label, place.latitude, place.longitude);
      this.placeSuggestions.set([]);
    } catch {
      this.clearCoordinates();
      this.error.set(
        'Could not resolve that place. Try another suggestion or type an address.',
      );
    }
  }

  /**
   * Reverse-geocodes a map click or marker drag into the location field.
   *
   * @param pick - Coordinates from the interactive map.
   */
  async onMapPicked(pick: MapPick): Promise<void> {
    this.draftLatitude = pick.latitude;
    this.draftLongitude = pick.longitude;
    this.mapLatitude.set(pick.latitude);
    this.mapLongitude.set(pick.longitude);
    try {
      const place = await this.places.reverse(pick.latitude, pick.longitude);
      this.draftLocation = place.label;
      this.draftLatitude = place.latitude;
      this.draftLongitude = place.longitude;
      this.placeSuggestions.set([]);
      this.error.set(undefined);
    } catch {
      this.draftLocation = `${pick.latitude.toFixed(5)}, ${pick.longitude.toFixed(5)}`;
      this.error.set(
        'Could not look up that pin. The coordinates were still saved.',
      );
    }
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
      const hasCoords =
        this.draftLatitude !== undefined && this.draftLongitude !== undefined;
      await this.api.createEvent(this.teamId(), {
        eventType: this.draftType,
        title,
        startsAt: wallTimeToIso(zone, key, this.draftStart),
        ...(this.draftEnd.length > 0
          ? { endsAt: wallTimeToIso(zone, key, this.draftEnd) }
          : {}),
        ...(location.length > 0 ? { location } : {}),
        ...(hasCoords
          ? { latitude: this.draftLatitude, longitude: this.draftLongitude }
          : {}),
        ...(recurrence !== undefined ? { recurrence } : {}),
      });
      this.modal.close(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'create_failed');
      this.saving.set(false);
    }
  }

  /**
   * Stores a resolved place on the draft and map pin.
   *
   * @param label - Display label for the location field.
   * @param latitude - Latitude in decimal degrees.
   * @param longitude - Longitude in decimal degrees.
   */
  private applyPlace(label: string, latitude: number, longitude: number): void {
    this.draftLocation = label;
    this.draftLatitude = latitude;
    this.draftLongitude = longitude;
    this.mapLatitude.set(latitude);
    this.mapLongitude.set(longitude);
    this.error.set(undefined);
  }

  /** Drops stored coordinates so a typed-only label does not keep a stale pin. */
  private clearCoordinates(): void {
    this.draftLatitude = undefined;
    this.draftLongitude = undefined;
    this.mapLatitude.set(undefined);
    this.mapLongitude.set(undefined);
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
      ...(this.draftFrequency === 'WEEKLY'
        ? { byWeekDay: [rruleWeekDay(this.dayKey())] }
        : {}),
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

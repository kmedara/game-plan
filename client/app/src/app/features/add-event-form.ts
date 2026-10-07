/**
 * Form for adding a practice, game, meeting, or other event on one day.
 */

import { Component, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
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

/** Transloco keys for the event type picker. */
const EVENT_TYPE_LABELS: Record<EventType, string> = {
  practice: 'eventType.practice',
  game: 'eventType.game',
  meeting: 'eventType.meeting',
  other: 'eventType.other',
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
  { value: 'ONCE', labelKey: 'addEvent.once' },
  { value: 'DAILY', labelKey: 'addEvent.daily' },
  { value: 'WEEKLY', labelKey: 'addEvent.weekly' },
  { value: 'MONTHLY', labelKey: 'addEvent.monthly' },
  { value: 'YEARLY', labelKey: 'addEvent.yearly' },
] as const;

/** Weekday key suffixes, Sunday first, aligned with {@link rruleWeekDay}. */
const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
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
    TranslocoPipe,
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
  private readonly transloco = inject(TranslocoService);

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
  /** Location input text (always a string — avoids Material object/ngModel fights). */
  locationField = '';
  draftLatitude: number | undefined;
  draftLongitude: number | undefined;
  draftFrequency: RepeatFrequency = 'ONCE';
  draftInterval = 1;

  /** Suggestion lookup by autocomplete option value (preview label). */
  private readonly suggestionsByLabel = new Map<string, PlaceSuggestion>();

  /**
   * When true, ignore location ngModelChange side effects (clear/search). Selecting
   * an option writes the input and would otherwise wipe the resolved place.
   */
  private suppressLocationSideEffects = false;

  /** Last resolved / map-picked label; ngModel echoes of this value are ignored. */
  private committedLocation = '';

  /**
   * Preview label for a suggestion row (also used as the mat-option value).
   *
   * @param suggestion - An autocomplete suggestion.
   * @returns Primary text plus secondary text when present.
   */
  suggestionLabel(suggestion: PlaceSuggestion): string {
    if (suggestion.secondaryText !== undefined && suggestion.secondaryText.length > 0) {
      return `${suggestion.primaryText}, ${suggestion.secondaryText}`;
    }
    return suggestion.primaryText;
  }

  /**
   * Plain-language reading of the `rrule` frequency and interval.
   *
   * @returns Empty when the event does not repeat.
   */
  repeatSummary(): string {
    if (this.draftFrequency === 'ONCE') return '';
    const interval = this.intervalCount();
    if (this.draftFrequency === 'DAILY') {
      return this.transloco.translate('addEvent.repeatEveryDays', { count: interval });
    }
    if (this.draftFrequency === 'WEEKLY') {
      const weekday = this.transloco.translate(
        `addEvent.weekday.${WEEKDAY_KEYS[RRULE_WEEKDAYS.indexOf(rruleWeekDay(this.dayKey()))]!}`,
      );
      return this.transloco.translate('addEvent.repeatEveryWeeks', {
        count: interval,
        weekday,
      });
    }
    if (this.draftFrequency === 'MONTHLY') {
      return this.transloco.translate('addEvent.repeatEveryMonths', { count: interval });
    }
    return this.transloco.translate('addEvent.repeatEveryYears', { count: interval });
  }

  /**
   * Updates the typed query and refreshes place suggestions.
   *
   * @param value - Current input text from ngModel.
   */
  onLocationInput(value: string): void {
    this.locationField = value;
    if (this.suppressLocationSideEffects) return;
    if (value === this.committedLocation) return;
    this.committedLocation = '';
    this.clearCoordinates();
    void this.places.autocomplete(value).then((suggestions) => {
      if (this.locationField !== value) return;
      this.suggestionsByLabel.clear();
      for (const suggestion of suggestions) {
        this.suggestionsByLabel.set(this.suggestionLabel(suggestion), suggestion);
      }
      this.placeSuggestions.set(suggestions);
    });
  }

  /**
   * Resolves a picked suggestion into the full address label and coordinates.
   *
   * @param previewLabel - The mat-option string value (suggestion preview).
   */
  async onPlaceSelected(previewLabel: string): Promise<void> {
    const suggestion = this.suggestionsByLabel.get(previewLabel);
    this.suppressLocationSideEffects = true;
    this.locationField = previewLabel;
    if (suggestion === undefined) {
      this.suppressLocationSideEffects = false;
      return;
    }
    try {
      const place = await this.places.resolve(suggestion.id);
      this.committedLocation = place.label;
      this.locationField = place.label;
      this.applyPlace(place.latitude, place.longitude);
      this.placeSuggestions.set([]);
      this.suggestionsByLabel.clear();
    } catch {
      this.committedLocation = '';
      this.clearCoordinates();
      this.error.set(
        'Could not resolve that place. Try another suggestion or type an address.',
      );
    } finally {
      setTimeout(() => {
        this.suppressLocationSideEffects = false;
      }, 0);
    }
  }

  /**
   * Reverse-geocodes a map click or marker drag into the location field.
   *
   * @param pick - Coordinates from the interactive map.
   */
  async onMapPicked(pick: MapPick): Promise<void> {
    this.suppressLocationSideEffects = true;
    this.draftLatitude = pick.latitude;
    this.draftLongitude = pick.longitude;
    this.mapLatitude.set(pick.latitude);
    this.mapLongitude.set(pick.longitude);
    try {
      const place = await this.places.reverse(pick.latitude, pick.longitude);
      this.committedLocation = place.label;
      this.locationField = place.label;
      this.draftLatitude = place.latitude;
      this.draftLongitude = place.longitude;
      this.placeSuggestions.set([]);
      this.error.set(undefined);
    } catch {
      this.committedLocation = `${pick.latitude.toFixed(5)}, ${pick.longitude.toFixed(5)}`;
      this.locationField = this.committedLocation;
      this.error.set(
        'Could not look up that pin. The coordinates were still saved.',
      );
    } finally {
      setTimeout(() => {
        this.suppressLocationSideEffects = false;
      }, 0);
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
      const location = this.locationField.trim();
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
   * @param latitude - Latitude in decimal degrees.
   * @param longitude - Longitude in decimal degrees.
   */
  private applyPlace(latitude: number, longitude: number): void {
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

}

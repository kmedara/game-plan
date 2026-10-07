import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AddEventFormComponent, eventTypeLabel } from './add-event-form';
import { ApiClientService } from '../core/api-client.service';
import { ModalRef } from '../core/modal.service';
import { PlaceSearchService } from './place-search';
import type { PlaceSuggestion } from './place-search';

describe('eventTypeLabel', () => {
  it('maps known types and passes through unknown values', () => {
    expect(eventTypeLabel('practice')).toBe('eventType.practice');
    expect(eventTypeLabel('custom_type')).toBe('custom_type');
  });
});

describe('AddEventFormComponent', () => {
  let fixture: ComponentFixture<AddEventFormComponent>;
  let api: SpyObj<ApiClientService>;
  let modal: SpyObj<ModalRef<boolean>>;
  let places: SpyObj<PlaceSearchService>;

  const suggestion: PlaceSuggestion = {
    id: 'place-1',
    primaryText: 'City Hall',
    secondaryText: 'Boston, MA',
  };

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', ['createEvent']);
    api.createEvent.mockResolvedValue(undefined);
    modal = createSpyObj<ModalRef<boolean>>('ModalRef', ['close']);
    places = createSpyObj<PlaceSearchService>('PlaceSearchService', [
      'autocomplete',
      'resolve',
      'reverse',
    ]);
    places.autocomplete.mockResolvedValue([]);
    places.resolve.mockResolvedValue({
      label: 'City Hall, Boston, MA',
      latitude: 42.36,
      longitude: -71.06,
    });
    places.reverse.mockResolvedValue({
      label: 'Pin address',
      latitude: 42.36,
      longitude: -71.06,
    });

    await TestBed.configureTestingModule({
      imports: [AddEventFormComponent],
      providers: [
        { provide: ApiClientService, useValue: api },
        { provide: ModalRef, useValue: modal },
        { provide: PlaceSearchService, useValue: places },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AddEventFormComponent);
    fixture.componentRef.setInput('teamId', 'team-1');
    fixture.componentRef.setInput('dayKey', '2026-10-05');
    fixture.componentRef.setInput('timeZone', 'America/New_York');
    fixture.detectChanges();
  });

  it('formats suggestion preview labels', () => {
    const component = fixture.componentInstance;
    expect(component.suggestionLabel(suggestion)).toBe('City Hall, Boston, MA');
    expect(component.suggestionLabel({ id: 'x', primaryText: 'Only' })).toBe('Only');
  });

  it('summarizes repeat rules', () => {
    const component = fixture.componentInstance;
    expect(component.repeatSummary()).toBe('');
    component.draftFrequency = 'DAILY';
    component.draftInterval = 2;
    expect(component.repeatSummary()).toBe('Every 2 days');
    component.draftFrequency = 'WEEKLY';
    component.draftInterval = 1;
    expect(component.repeatSummary()).toContain('Monday');
    component.draftInterval = 0;
    expect(component.repeatSummary()).toBe('Every 1 weeks on Monday');
  });

  it('loads suggestions for typed text', async () => {
    const component = fixture.componentInstance;
    component.onLocationInput('bos');
    expect(places.autocomplete).toHaveBeenCalledWith('bos');
    places.autocomplete.mockResolvedValue([suggestion]);
    component.onLocationInput('city');
    await fixture.whenStable();
    expect(component.placeSuggestions()).toEqual([suggestion]);
  });

  it('resolves a selected place to the full address and handles failures', async () => {
    const component = fixture.componentInstance;
    places.autocomplete.mockResolvedValue([suggestion]);
    component.onLocationInput('city');
    await fixture.whenStable();

    places.resolve.mockResolvedValue({
      label: 'City Hall, 1 City Hall Square, Boston, MA',
      latitude: 42.36,
      longitude: -71.06,
    });
    await component.onPlaceSelected(component.suggestionLabel(suggestion));
    expect(component.locationField).toBe('City Hall, 1 City Hall Square, Boston, MA');
    expect(component.mapLatitude()).toBe(42.36);

    places.autocomplete.mockResolvedValue([suggestion]);
    component.onLocationInput('city');
    await fixture.whenStable();
    places.resolve.mockRejectedValue(new Error('fail'));
    await component.onPlaceSelected(component.suggestionLabel(suggestion));
    expect(component.error()).toContain('Could not resolve');
  });

  it('does not clear the resolved place when ngModel echoes the selection', async () => {
    const component = fixture.componentInstance;
    places.autocomplete.mockResolvedValue([suggestion]);
    component.onLocationInput('city');
    await fixture.whenStable();

    places.resolve.mockResolvedValue({
      label: 'City Hall, 1 City Hall Square, Boston, MA',
      latitude: 42.36,
      longitude: -71.06,
    });
    await component.onPlaceSelected(component.suggestionLabel(suggestion));
    component.onLocationInput('City Hall, 1 City Hall Square, Boston, MA');
    expect(component.mapLatitude()).toBe(42.36);
    expect(component.locationField).toBe('City Hall, 1 City Hall Square, Boston, MA');
  });

  it('reverse-geocodes map picks and falls back to coordinates', async () => {
    const component = fixture.componentInstance;
    await component.onMapPicked({ latitude: 42.36, longitude: -71.06 });
    expect(component.locationField).toBe('Pin address');

    places.reverse.mockRejectedValue(new Error('fail'));
    await component.onMapPicked({ latitude: 1.23456, longitude: 7.89012 });
    expect(component.locationField).toContain('1.23456');
    expect(component.error()).toContain('Could not look up');
  });

  it('closes without saving when cancelled', () => {
    fixture.componentInstance.cancel();
    expect(modal.close).toHaveBeenCalledWith(false);
  });

  it('validates and submits an event', async () => {
    const component = fixture.componentInstance;
    await component.submit();
    expect(api.createEvent).not.toHaveBeenCalled();

    component.draftTitle = '  Practice  ';
    component.draftEnd = '17:00';
    await component.submit();
    expect(component.error()).toContain('End time');

    component.draftEnd = '20:00';
    component.draftInterval = 0;
    component.draftFrequency = 'DAILY';
    await component.submit();
    expect(component.error()).toContain('Interval');

    component.draftInterval = 1;
    component.draftFrequency = 'WEEKLY';
    component.locationField = ' Gym ';
    component.draftLatitude = 1;
    component.draftLongitude = 2;
    await component.submit();
    expect(api.createEvent).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({
        title: 'Practice',
        recurrence: { frequency: 'WEEKLY', interval: 1, byWeekDay: ['MO'] },
        location: 'Gym',
        latitude: 1,
        longitude: 2,
      }),
    );
    expect(modal.close).toHaveBeenCalledWith(true);

  });

  it('omits the end time, location, and weekday rule when they do not apply', async () => {
    const component = fixture.componentInstance;
    component.draftTitle = 'Social';
    component.draftEnd = '';
    component.draftFrequency = 'MONTHLY';
    component.draftInterval = 2;
    await component.submit();
    const [, body] = api.createEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(body['endsAt']).toBeUndefined();
    expect(body['location']).toBeUndefined();
    expect(body['latitude']).toBeUndefined();
    expect(body['recurrence']).toEqual({ frequency: 'MONTHLY', interval: 2 });
    expect(component.repeatSummary()).toBe('Every 2 months');
  });

  it('shows a generic error when create rejects with a non-error', async () => {
    const component = fixture.componentInstance;
    api.createEvent.mockRejectedValue('nope');
    component.draftTitle = 'Retry';
    await component.submit();
    expect(component.error()).toBe('create_failed');
    expect(component.saving()).toBe(false);
  });

  it('surfaces create failures', async () => {
    const component = fixture.componentInstance;
    api.createEvent.mockRejectedValue(new Error('create_failed'));
    component.draftTitle = 'Retry';
    component.draftFrequency = 'ONCE';
    await component.submit();
    expect(component.error()).toBe('create_failed');
    expect(component.saving()).toBe(false);
  });
});

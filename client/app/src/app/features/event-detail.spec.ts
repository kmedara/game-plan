import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import type { ScheduleOccurrence } from '@gameplan/types';
import { EventDetailComponent } from './event-detail';
import { ApiClientService } from '../core/api-client.service';
import { ModalRef } from '../core/modal.service';
import { provideTranslocoForTests } from '../../testing/transloco';
import * as placeSearch from './place-search';

describe('EventDetailComponent', () => {
  let fixture: ComponentFixture<EventDetailComponent>;
  let api: SpyObj<ApiClientService>;
  let modal: SpyObj<ModalRef<boolean>>;

  const occurrence: ScheduleOccurrence = {
    eventId: 'e1',
    eventType: 'practice',
    title: 'Evening practice',
    startsAt: '2026-10-05T22:00:00.000Z',
    endsAt: '2026-10-05T23:30:00.000Z',
    location: 'Field 2',
    latitude: 42.36,
    longitude: -71.06,
    rsvps: [
      { userId: 'user-1', status: 'going' },
      { userId: 'user-2', status: 'maybe' },
    ],
  };

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', [
      'listMembers',
      'putRsvp',
    ]);
    api.listMembers.mockResolvedValue([
      {
        userId: 'user-1',
        role: 'player',
        joinedAt: '2026-01-01T00:00:00.000Z',
        displayName: 'Alex',
      },
      {
        userId: 'user-2',
        role: 'player',
        joinedAt: '2026-01-01T00:00:00.000Z',
        displayName: 'Blake',
      },
    ]);
    api.putRsvp.mockResolvedValue({
      eventId: 'e1',
      occurrenceStartsAt: occurrence.startsAt,
      userId: 'user-1',
      status: 'maybe',
      updatedAt: '2026-10-05T12:00:00.000Z',
    });
    Object.defineProperty(api, 'user', {
      get: () => ({ userId: 'user-1' }),
      configurable: true,
    });
    modal = createSpyObj<ModalRef<boolean>>('ModalRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [EventDetailComponent],
      providers: [
        ...provideTranslocoForTests(),
        { provide: ApiClientService, useValue: api },
        { provide: ModalRef, useValue: modal },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventDetailComponent);
    fixture.componentRef.setInput('occurrence', occurrence);
    fixture.componentRef.setInput('teamId', 'team-1');
    fixture.componentRef.setInput('timeZone', 'America/New_York');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('shows occurrence details, roster names, and maps helpers', async () => {
    const component = fixture.componentInstance;
    expect(component.item()?.title).toBe('Evening practice');
    expect(component.dayLabel().length).toBeGreaterThan(0);
    expect(component.timeLabel(occurrence.startsAt)).toContain(':');
    expect(component.myRsvp()).toBe('going');
    expect(component.namesFor('going')).toEqual(['Alex']);
    expect(component.namesFor('maybe')).toEqual(['Blake']);
    expect(component.namesFor('not_going')).toEqual([]);
    expect(component.rsvpChoiceKey('going')).toBe('schedule.going');

    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    expect(component.primaryMapsProvider()).toBe('google');
    expect(component.showSecondaryMapsLink()).toBe(true);
    expect(component.secondaryMapsProvider()).toBe('apple');
    expect(component.mapsProviderLabel('apple')).toBe('maps.apple');

    const openMaps = vi
      .spyOn(placeSearch, 'openPlaceInMaps')
      .mockImplementation(() => undefined);
    component.openMaps('google');
    expect(openMaps).toHaveBeenCalled();
  });

  it('updates RSVP locally and closes with changed=true', async () => {
    const component = fixture.componentInstance;
    await component.rsvp('going');
    expect(api.putRsvp).not.toHaveBeenCalled();

    await component.rsvp('maybe');
    expect(api.putRsvp).toHaveBeenCalledWith('team-1', {
      eventId: 'e1',
      occurrenceStartsAt: occurrence.startsAt,
      status: 'maybe',
    });
    expect(component.myRsvp()).toBe('maybe');

    component.close();
    expect(modal.close).toHaveBeenCalledWith(true);
  });

  it('surfaces RSVP failures and closes unchanged when nothing was saved', async () => {
    const component = fixture.componentInstance;
    api.putRsvp.mockRejectedValue(new Error('rsvp_failed'));
    await component.rsvp('not_going');
    expect(component.error()).toBe('rsvp_failed');
    component.close();
    expect(modal.close).toHaveBeenCalledWith(false);
  });
});

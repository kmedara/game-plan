import { createSpyObj, type SpyObj } from '../../../testing/spy';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService } from '../../core/api-client.service';
import { PlaceSearchService } from './place-search.service';

describe('PlaceSearchService', () => {
  let api: SpyObj<ApiClientService>;
  let service: PlaceSearchService;

  beforeEach(() => {
    vi.useFakeTimers();
    api = createSpyObj<ApiClientService>('ApiClientService', [
      'autocompletePlaces',
      'resolvePlace',
      'reverseGeocodePlace',
    ]);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiClientService, useValue: api }],
    });
    service = TestBed.inject(PlaceSearchService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no suggestions for blank queries', async () => {
    await expect(service.autocomplete('   ')).resolves.toEqual([]);
    expect(api.autocompletePlaces).not.toHaveBeenCalled();
  });

  it('debounces autocomplete and resolves suggestions', async () => {
    api.autocompletePlaces.mockResolvedValue([
      { id: 'p1', primaryText: 'Park' },
    ]);
    const pending = service.autocomplete('park');
    expect(api.autocompletePlaces).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toEqual([{ id: 'p1', primaryText: 'Park' }]);
  });

  it('returns an empty list when autocomplete fails', async () => {
    api.autocompletePlaces.mockRejectedValue(new Error('network'));
    const pending = service.autocomplete('park');
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toEqual([]);
  });

  it('ignores stale autocomplete responses after a newer query', async () => {
    let resolveFirst!: (value: Array<{ id: string; primaryText: string }>) => void;
    api.autocompletePlaces
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([{ id: 'p2', primaryText: 'Second' }]);

    const first = service.autocomplete('one');
    await vi.advanceTimersByTimeAsync(300);
    const second = service.autocomplete('two');
    await vi.advanceTimersByTimeAsync(300);
    resolveFirst([{ id: 'p1', primaryText: 'First' }]);
    await expect(second).resolves.toEqual([{ id: 'p2', primaryText: 'Second' }]);
    // The first promise never settles after a newer generation wins.
    void first;
  });

  it('resolves and reverse-geocodes through the API', async () => {
    api.resolvePlace.mockResolvedValue({
      label: 'Park',
      latitude: 1,
      longitude: 2,
    });
    api.reverseGeocodePlace.mockResolvedValue({
      label: 'Corner',
      latitude: 3,
      longitude: 4,
    });
    await expect(service.resolve('id-1')).resolves.toEqual({
      label: 'Park',
      latitude: 1,
      longitude: 2,
    });
    await expect(service.reverse(3, 4)).resolves.toEqual({
      label: 'Corner',
      latitude: 3,
      longitude: 4,
    });
  });
});

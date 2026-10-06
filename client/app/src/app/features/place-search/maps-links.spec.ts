import { afterEach, describe, expect, it, vi } from 'vitest';
import { appleMapsUrl, googleMapsUrl, openPlaceInMaps } from './maps-links';

describe('maps-links', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds Apple Maps urls with and without coordinates', () => {
    expect(appleMapsUrl({ label: 'Field' })).toBe(
      'https://maps.apple.com/?q=Field',
    );
    expect(appleMapsUrl({ label: 'Field', latitude: 1.5, longitude: -2.25 })).toBe(
      'https://maps.apple.com/?q=Field&ll=1.5%2C-2.25',
    );
  });

  it('builds Google Maps urls with coordinates or a label query', () => {
    expect(googleMapsUrl({ label: 'Field', latitude: 1.5, longitude: -2.25 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=1.5%2C-2.25',
    );
    expect(googleMapsUrl({ label: 'Main Field' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Main%20Field',
    );
  });

  it('opens the preferred maps app', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openPlaceInMaps({ label: 'Field' }, 'apple');
    expect(open).toHaveBeenCalledWith(
      'https://maps.apple.com/?q=Field',
      '_blank',
      'noopener,noreferrer',
    );
    openPlaceInMaps({ label: 'Field', latitude: 1, longitude: 2 }, 'google');
    expect(open).toHaveBeenCalledWith(
      'https://www.google.com/maps/search/?api=1&query=1%2C2',
      '_blank',
      'noopener,noreferrer',
    );
  });
});

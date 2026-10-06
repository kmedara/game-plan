/**
 * Google Places client parsing coverage.
 */

import { describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

process.env.GOOGLE_MAPS_API_KEY = 'test-key';

const { autocompletePlaces, fetchStaticMapPng, reverseGeocode } = await import(
  './google-places.js'
);

describe('google-places autocomplete', () => {
  it('uses the place id as primary text when labels are missing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          suggestions: [{ placePrediction: { placeId: 'pid-only' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const suggestions = await autocompletePlaces('park');
    expect(suggestions).toEqual([{ id: 'pid-only', primaryText: 'pid-only' }]);
  });
});

describe('google-places reverse geocode and static map', () => {
  it('falls back to coordinates when OK results have a blank address', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'OK', results: [{ formatted_address: '  ' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const pin = await reverseGeocode(1.23456, 7.89);
    expect(pin.label).toBe('1.23456, 7.89000');
  });

  it('rejects static map responses that are not images', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not-an-image', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    await expect(fetchStaticMapPng(30, -97)).rejects.toThrow('places_upstream_error');
  });

  it('returns png bytes for image responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    const png = await fetchStaticMapPng(30, -97);
    expect(png.length).toBe(3);
  });

  it('rejects static map responses with a missing content-type', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bytes', { status: 200, headers: {} }));
    await expect(fetchStaticMapPng(30, -97)).rejects.toThrow('places_upstream_error');
  });

  it('rejects static map responses with an empty content-type', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('bytes', { status: 200, headers: { 'content-type': '' } }),
    );
    await expect(fetchStaticMapPng(30, -97)).rejects.toThrow('places_upstream_error');
  });

  it('uses coordinates when reverse geocode returns no formatted address', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'OK', results: [{}] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const pin = await reverseGeocode(10, 20);
    expect(pin.label).toBe('10.00000, 20.00000');
  });
});

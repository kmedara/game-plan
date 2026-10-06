import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { GoogleMap } from '@capacitor/google-maps';
import { Capacitor } from '@capacitor/core';
import { LocationMapComponent } from './location-map';
import { MapPicker, MapsKey } from './native-maps';

const envState = vi.hoisted(() => ({ googleMapsApiKey: '' }));

vi.mock('../../../environments/environment', () => ({
  environment: envState,
}));

const platformState = vi.hoisted(() => ({ value: 'web' as string }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platformState.value,
  },
}));

const webMapClick = vi.hoisted(() => ({
  handler: undefined as ((event: { latLng: { lat: () => number; lng: () => number } | null }) => void) | undefined,
}));

const mockWebMap = vi.hoisted(() => ({
  addListener: vi.fn(
    (
      event: string,
      cb: (event: { latLng: { lat: () => number; lng: () => number } | null }) => void,
    ) => {
      if (event === 'click') webMapClick.handler = cb;
    },
  ),
  panTo: vi.fn(),
  setCenter: vi.fn(),
  setZoom: vi.fn(),
  getZoom: vi.fn(() => 4),
}));

const MockMapConstructor = vi.hoisted(() => vi.fn(() => mockWebMap));

const markerDragEnd = vi.hoisted(() => ({
  handler: undefined as (() => void) | undefined,
}));

const mockWebMarker = vi.hoisted(() => ({
  setMap: vi.fn(),
  setPosition: vi.fn(),
  addListener: vi.fn((event: string, cb: () => void) => {
    if (event === 'dragend') markerDragEnd.handler = cb;
  }),
  getPosition: vi.fn(),
}));

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: vi.fn(),
  importLibrary: vi.fn(async (library: string) => {
    if (library === 'maps') return { Map: MockMapConstructor };
    return {};
  }),
}));

const nativeMapClick = vi.hoisted(() => ({
  handler: undefined as ((event: { latitude: number; longitude: number }) => void) | undefined,
}));

const nativeMarkerDragEnd = vi.hoisted(() => ({
  handler: undefined as ((event: { latitude: number; longitude: number }) => void) | undefined,
}));

const mockNativeMap = vi.hoisted(() => ({
  destroy: vi.fn().mockResolvedValue(undefined),
  setOnMapClickListener: vi.fn(async (cb: (event: { latitude: number; longitude: number }) => void) => {
    nativeMapClick.handler = cb;
  }),
  setOnMarkerDragEndListener: vi.fn(
    async (cb: (event: { latitude: number; longitude: number }) => void) => {
      nativeMarkerDragEnd.handler = cb;
    },
  ),
  addMarker: vi.fn().mockResolvedValue('native-marker'),
  removeMarker: vi.fn().mockResolvedValue(undefined),
  setCamera: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/google-maps', () => ({
  GoogleMap: {
    create: vi.fn(async () => mockNativeMap),
  },
}));

vi.mock('./native-maps', () => ({
  MapsKey: { getAndroidMapsApiKey: vi.fn() },
  MapPicker: { pickOnMap: vi.fn() },
}));

type LocationMapInternals = LocationMapComponent & {
  initWebMap: () => Promise<void>;
  initAndroidMap: () => Promise<void>;
  placeNativePin: (latitude: number, longitude: number, fly: boolean) => Promise<void>;
  placeWebPin: (latitude: number, longitude: number, fly: boolean) => Promise<void>;
  applyCoordinates: (
    latitude: number | undefined,
    longitude: number | undefined,
    fly: boolean,
  ) => Promise<void>;
  mapCanvas: ReturnType<typeof signal<{ nativeElement: HTMLElement } | undefined>>;
  syncingFromParent: boolean;
};

describe('LocationMapComponent', () => {
  let fixture: ComponentFixture<LocationMapComponent>;
  let component: LocationMapComponent;

  const internals = () => component as LocationMapInternals;

  const flushInit = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    platformState.value = 'web';
    envState.googleMapsApiKey = '';
    webMapClick.handler = undefined;
    markerDragEnd.handler = undefined;
    nativeMapClick.handler = undefined;
    nativeMarkerDragEnd.handler = undefined;
    mockWebMarker.getPosition.mockReset();
    MockMapConstructor.mockClear();
    vi.mocked(GoogleMap.create).mockClear();
    vi.mocked(GoogleMap.create).mockResolvedValue(mockNativeMap as never);
    vi.mocked(MapsKey.getAndroidMapsApiKey).mockReset();
    vi.mocked(MapPicker.pickOnMap).mockReset();
    vi.mocked(importLibrary).mockImplementation(async (library: string) => {
      if (library === 'maps') return { Map: MockMapConstructor };
      return {};
    });

    (globalThis as { google?: unknown }).google = {
      maps: {
        Marker: vi.fn(() => mockWebMarker),
      },
    };

    TestBed.configureTestingModule({
      imports: [LocationMapComponent],
    });
  });

  describe('web', () => {
    it('marks the map unavailable when the browser API key is missing', async () => {
      envState.googleMapsApiKey = '   ';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();

      expect(component.unavailable()).toBe(true);
      expect(component.hint()).toContain('GOOGLE_MAPS_BROWSER_API_KEY');
    });

    it('loads Google Maps and emits a pick on map click', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      const picks: { latitude: number; longitude: number }[] = [];
      component.locationPicked.subscribe((pick) => picks.push(pick));

      await flushInit();

      expect(setOptions).toHaveBeenCalledWith({ key: 'browser-key', v: 'weekly' });
      expect(MockMapConstructor).toHaveBeenCalled();
      webMapClick.handler?.({
        latLng: { lat: () => 41.1, lng: () => -71.2 },
      });
      await fixture.whenStable();
      expect(picks).toEqual([{ latitude: 41.1, longitude: -71.2 }]);
    });

    it('ignores map clicks without coordinates', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      const picks: unknown[] = [];
      component.locationPicked.subscribe((pick) => picks.push(pick));
      await flushInit();

      webMapClick.handler?.({ latLng: null });
      expect(picks).toEqual([]);
    });

    it('places an initial pin when coordinates are provided', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('latitude', 10);
      fixture.componentRef.setInput('longitude', 20);
      await flushInit();

      expect(component.hasPin()).toBe(true);
      expect(mockWebMap.setCenter).toHaveBeenCalled();
    });

    it('emits when the web marker is dragged', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      const picks: { latitude: number; longitude: number }[] = [];
      component.locationPicked.subscribe((pick) => picks.push(pick));
      await flushInit();

      webMapClick.handler?.({
        latLng: { lat: () => 1, lng: () => 2 },
      });
      mockWebMarker.getPosition.mockReturnValue({
        lat: () => 3,
        lng: () => 4,
      });
      markerDragEnd.handler?.();
      expect(picks).toContainEqual({ latitude: 3, longitude: 4 });
    });

    it('syncs parent coordinates and clears the marker when inputs are removed', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('latitude', 5);
      fixture.componentRef.setInput('longitude', 6);
      await flushInit();

      fixture.componentRef.setInput('latitude', undefined);
      fixture.componentRef.setInput('longitude', undefined);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockWebMarker.setMap).toHaveBeenCalledWith(null);
    });

    it('pans the camera when parent coordinates change with fly enabled', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();

      fixture.componentRef.setInput('latitude', 12);
      fixture.componentRef.setInput('longitude', 34);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockWebMap.panTo).toHaveBeenCalledWith({ lat: 12, lng: 34 });
    });

    it('marks the map unavailable when the loader fails', async () => {
      envState.googleMapsApiKey = 'browser-key';
      vi.mocked(importLibrary).mockRejectedValueOnce(new Error('load failed'));
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();

      expect(component.unavailable()).toBe(true);
      expect(component.hint()).toContain('Could not load Google Maps');
    });

    it('updates an existing marker position on subsequent pins', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();

      webMapClick.handler?.({
        latLng: { lat: () => 1, lng: () => 2 },
      });
      webMapClick.handler?.({
        latLng: { lat: () => 3, lng: () => 4 },
      });
      await fixture.whenStable();

      expect(mockWebMarker.setPosition).toHaveBeenCalledWith({ lat: 3, lng: 4 });
    });

    it('marks the map unavailable when the canvas element is missing', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      internals().mapCanvas = signal(undefined);
      await internals().initWebMap();
      expect(component.unavailable()).toBe(true);
    });

    it('ignores map clicks while syncing coordinates from the parent', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      const picks: unknown[] = [];
      component.locationPicked.subscribe((pick) => picks.push(pick));
      await flushInit();

      internals().syncingFromParent = true;
      webMapClick.handler?.({
        latLng: { lat: () => 1, lng: () => 2 },
      });
      expect(picks).toEqual([]);
    });

    it('ignores drag events without a marker position', async () => {
      envState.googleMapsApiKey = 'browser-key';
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      const picks: unknown[] = [];
      component.locationPicked.subscribe((pick) => picks.push(pick));
      await flushInit();

      webMapClick.handler?.({
        latLng: { lat: () => 1, lng: () => 2 },
      });
      mockWebMarker.getPosition.mockReturnValue(null);
      markerDragEnd.handler?.();
      expect(picks).toHaveLength(1);
    });

    it('no-ops web pin placement before the map exists', async () => {
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await expect(internals().placeWebPin(1, 2, false)).resolves.toBeUndefined();
    });

    it('falls back to the default zoom when getZoom returns undefined', async () => {
      envState.googleMapsApiKey = 'browser-key';
      mockWebMap.getZoom.mockReturnValue(undefined as never);
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();

      webMapClick.handler?.({
        latLng: { lat: () => 1, lng: () => 2 },
      });
      expect(mockWebMap.setZoom).toHaveBeenCalledWith(15);
    });
  });

  describe('ios', () => {
    beforeEach(() => {
      platformState.value = 'ios';
    });

    it('shows the MapKit button and emits a picked location', async () => {
      vi.mocked(MapPicker.pickOnMap).mockResolvedValue({
        latitude: 37.3,
        longitude: -122.1,
      });
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      const picks: { latitude: number; longitude: number }[] = [];
      component.locationPicked.subscribe((pick) => picks.push(pick));
      await flushInit();

      expect(component.hint()).toContain('open the map');
      const button: HTMLButtonElement = fixture.nativeElement.querySelector('.location-map-ios-btn');
      button.click();
      await fixture.whenStable();
      expect(picks).toEqual([{ latitude: 37.3, longitude: -122.1 }]);
    });

    it('ignores MapKit cancellation', async () => {
      vi.mocked(MapPicker.pickOnMap).mockRejectedValue(new Error('cancelled'));
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      const picks: unknown[] = [];
      component.locationPicked.subscribe((pick) => picks.push(pick));
      await flushInit();

      await component.openIosPicker();
      expect(picks).toEqual([]);
    });

    it('reports hasPin and shows coordinates when inputs are set', async () => {
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('latitude', 1.23456);
      fixture.componentRef.setInput('longitude', 7.89012);
      await flushInit();

      expect(component.hasPin()).toBe(true);
      expect(fixture.nativeElement.textContent).toContain('1.23456');
    });

    it('passes only the latitude seed to MapKit when longitude is unset', async () => {
      vi.mocked(MapPicker.pickOnMap).mockResolvedValue({ latitude: 2, longitude: 3 });
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('latitude', 9);
      await flushInit();

      await component.openIosPicker();
      expect(MapPicker.pickOnMap).toHaveBeenCalledWith({ latitude: 9 });
    });

    it('passes only the longitude seed to MapKit when latitude is unset', async () => {
      vi.mocked(MapPicker.pickOnMap).mockResolvedValue({ latitude: 2, longitude: 3 });
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('longitude', 9);
      await flushInit();

      await component.openIosPicker();
      expect(MapPicker.pickOnMap).toHaveBeenCalledWith({ longitude: 9 });
    });

    it('skips coordinate sync on iOS when parent inputs change', async () => {
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();
      await expect(internals().applyCoordinates(1, 2, true)).resolves.toBeUndefined();
    });
  });

  describe('android', () => {
    beforeEach(() => {
      platformState.value = 'android';
    });

    it('marks the map unavailable when the Android key is missing', async () => {
      vi.mocked(MapsKey.getAndroidMapsApiKey).mockResolvedValue({ apiKey: '  ' });
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();

      expect(component.unavailable()).toBe(true);
      expect(component.hint()).toContain('GOOGLE_MAPS_ANDROID_API_KEY');
    });

    it('creates a native map and handles click and drag events', async () => {
      vi.mocked(MapsKey.getAndroidMapsApiKey).mockResolvedValue({ apiKey: 'android-key' });
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      const picks: { latitude: number; longitude: number }[] = [];
      component.locationPicked.subscribe((pick) => picks.push(pick));
      fixture.componentRef.setInput('latitude', 9);
      fixture.componentRef.setInput('longitude', 8);
      await flushInit();

      nativeMapClick.handler?.({ latitude: 50, longitude: 60 });
      await fixture.whenStable();
      await Promise.resolve();
      mockNativeMap.removeMarker.mockClear();
      nativeMapClick.handler?.({ latitude: 52, longitude: 62 });
      nativeMarkerDragEnd.handler?.({ latitude: 51, longitude: 61 });
      await fixture.whenStable();
      await Promise.resolve();

      expect(GoogleMap.create).toHaveBeenCalled();
      expect(mockNativeMap.removeMarker).toHaveBeenCalledWith('native-marker');
      expect(picks).toEqual([
        { latitude: 50, longitude: 60 },
        { latitude: 52, longitude: 62 },
        { latitude: 51, longitude: 61 },
      ]);
    });

    it('marks the map unavailable when the native canvas is missing', async () => {
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      internals().mapCanvas = signal(undefined);
      await internals().initAndroidMap();
      expect(component.unavailable()).toBe(true);
    });

    it('no-ops native pin placement before the map exists', async () => {
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await expect(internals().placeNativePin(1, 2, false)).resolves.toBeUndefined();
    });

    it('ignores native map clicks while syncing coordinates from the parent', async () => {
      vi.mocked(MapsKey.getAndroidMapsApiKey).mockResolvedValue({ apiKey: 'android-key' });
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      const picks: unknown[] = [];
      component.locationPicked.subscribe((pick) => picks.push(pick));
      await flushInit();

      internals().syncingFromParent = true;
      nativeMapClick.handler?.({ latitude: 50, longitude: 60 });
      nativeMarkerDragEnd.handler?.({ latitude: 51, longitude: 61 });
      expect(picks).toEqual([]);
    });

    it('destroys the native map on teardown', async () => {
      vi.mocked(MapsKey.getAndroidMapsApiKey).mockResolvedValue({ apiKey: 'android-key' });
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();
      fixture.destroy();
      await fixture.whenStable();

      expect(mockNativeMap.destroy).toHaveBeenCalled();
    });

    it('marks the map unavailable when native map creation fails', async () => {
      vi.mocked(MapsKey.getAndroidMapsApiKey).mockResolvedValue({ apiKey: 'android-key' });
      vi.mocked(GoogleMap.create).mockRejectedValueOnce(new Error('sdk'));
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();

      expect(component.unavailable()).toBe(true);
      expect(component.hint()).toContain('Could not load Google Maps on Android');
    });

    it('clears native markers when coordinates are removed', async () => {
      vi.mocked(MapsKey.getAndroidMapsApiKey).mockResolvedValue({ apiKey: 'android-key' });
      fixture = TestBed.createComponent(LocationMapComponent);
      component = fixture.componentInstance;
      await flushInit();

      fixture.componentRef.setInput('latitude', 1);
      fixture.componentRef.setInput('longitude', 2);
      fixture.detectChanges();
      await fixture.whenStable();
      await Promise.resolve();
      mockNativeMap.removeMarker.mockClear();

      fixture.componentRef.setInput('latitude', undefined);
      fixture.componentRef.setInput('longitude', undefined);
      fixture.detectChanges();
      await fixture.whenStable();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockNativeMap.removeMarker).toHaveBeenCalledWith('native-marker');
    });
  });
});

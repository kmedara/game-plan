/**
 * Interactive location map: Google Maps JS (web), Maps SDK (Android), MapKit (iOS).
 */

import { DecimalPipe } from '@angular/common';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { GoogleMap } from '@capacitor/google-maps';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { environment } from '../../../environments/environment';
import { MapPicker, MapsKey } from './native-maps';

/** Default view before the user picks a place (continental US). */
const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 };
const DEFAULT_ZOOM = 4;
const SELECTED_ZOOM = 15;

/** Coordinates emitted when the user clicks or drags the marker. */
export type MapPick = {
  latitude: number;
  longitude: number;
};

@Component({
  selector: 'app-location-map',
  standalone: true,
  imports: [DecimalPipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="location-map" role="application" aria-label="Location map">
      <p class="location-map-hint muted">{{ hint() }}</p>
      @if (unavailable()) {
        <div class="location-map-unavailable">Map unavailable. Set the platform Maps API key.</div>
      } @else if (platform === 'ios') {
        <button
          type="button"
          class="location-map-ios-btn"
          (click)="openIosPicker()"
        >
          {{ hasPin() ? 'Adjust pin on map' : 'Set pin on map' }}
        </button>
        @if (hasPin()) {
          <p class="location-map-coords muted">
            {{ latitude() | number: '1.5-5' }}, {{ longitude() | number: '1.5-5' }}
          </p>
        }
      } @else if (platform === 'android') {
        <capacitor-google-map #mapCanvas class="location-map-canvas"></capacitor-google-map>
      } @else {
        <div class="location-map-canvas" #mapCanvas></div>
      }
    </div>
  `,
  styles: [
    `
      .location-map {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }

      .location-map-hint {
        margin: 0;
        font-size: 0.8125rem;
      }

      .location-map-canvas {
        display: block;
        width: 100%;
        height: 14rem;
        border-radius: 0.5rem;
        overflow: hidden;
        border: 1px solid var(--mat-sys-outline-variant);
        background: var(--mat-sys-surface-container);
        z-index: 0;
      }

      .location-map-unavailable {
        padding: 0.75rem 1rem;
        border-radius: 0.5rem;
        border: 1px dashed var(--mat-sys-outline-variant);
        font-size: 0.875rem;
        color: var(--mat-sys-on-surface-variant);
      }

      .location-map-ios-btn {
        min-height: 2.75rem;
        border-radius: 0.5rem;
        border: 1px solid var(--mat-sys-outline-variant);
        background: var(--mat-sys-surface-container);
        color: var(--mat-sys-on-surface);
        font: inherit;
        cursor: pointer;
      }

      .location-map-coords {
        margin: 0;
        font-size: 0.8125rem;
      }
    `,
  ],
})
export class LocationMapComponent implements OnDestroy {
  /** Selected latitude, when a place is set. */
  readonly latitude = input<number | undefined>(undefined);

  /** Selected longitude, when a place is set. */
  readonly longitude = input<number | undefined>(undefined);

  /** Emitted when the user places or moves the pin. */
  readonly locationPicked = output<MapPick>();

  readonly platform = Capacitor.getPlatform();
  readonly unavailable = signal(false);
  readonly hint = signal('Search below or tap the map to set a pin.');

  private readonly mapCanvas = viewChild<ElementRef<HTMLElement>>('mapCanvas');

  private webMap: google.maps.Map | undefined;
  private webMarker: google.maps.Marker | undefined;
  private nativeMap: GoogleMap | undefined;
  private nativeMarkerId: string | undefined;
  /** Skips emit when the parent pushes coordinates from autocomplete. */
  private syncingFromParent = false;
  private initialized = false;

  constructor() {
    afterNextRender(() => {
      void this.initMap();
    });

    effect(() => {
      const latitude = this.latitude();
      const longitude = this.longitude();
      if (!this.initialized) return;
      this.syncingFromParent = true;
      try {
        void this.applyCoordinates(latitude, longitude, true);
      } finally {
        this.syncingFromParent = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.webMarker = undefined;
    this.webMap = undefined;
    if (this.nativeMap !== undefined) {
      void this.nativeMap.destroy();
      this.nativeMap = undefined;
      this.nativeMarkerId = undefined;
    }
  }

  /** Whether a pin coordinate is currently set. */
  hasPin(): boolean {
    return this.latitude() !== undefined && this.longitude() !== undefined;
  }

  /** Opens the MapKit modal picker on iOS. */
  async openIosPicker(): Promise<void> {
    try {
      const result = await MapPicker.pickOnMap({
        ...(this.latitude() !== undefined ? { latitude: this.latitude() } : {}),
        ...(this.longitude() !== undefined ? { longitude: this.longitude() } : {}),
      });
      this.locationPicked.emit({
        latitude: result.latitude,
        longitude: result.longitude,
      });
    } catch {
      // User cancelled or MapKit is unavailable.
    }
  }

  /** Creates the platform map and wires click / drag handlers. */
  private async initMap(): Promise<void> {
    if (this.platform === 'ios') {
      this.hint.set('Search below or open the map to set a pin.');
      this.initialized = true;
      return;
    }

    if (this.platform === 'android') {
      await this.initAndroidMap();
      return;
    }

    await this.initWebMap();
  }

  /** Loads Maps JavaScript API for the browser. */
  private async initWebMap(): Promise<void> {
    const apiKey = environment.googleMapsApiKey.trim();
    if (apiKey.length === 0) {
      this.unavailable.set(true);
      this.hint.set('Map requires GOOGLE_MAPS_BROWSER_API_KEY.');
      return;
    }

    const host = this.mapCanvas()?.nativeElement;
    if (host === undefined) {
      this.unavailable.set(true);
      return;
    }

    try {
      setOptions({ key: apiKey, v: 'weekly' });
      const { Map } = await importLibrary('maps');
      await importLibrary('marker');

      const latitude = this.latitude();
      const longitude = this.longitude();
      const hasPin = latitude !== undefined && longitude !== undefined;
      const center = hasPin
        ? { lat: latitude, lng: longitude }
        : DEFAULT_CENTER;

      this.webMap = new Map(host as HTMLElement, {
        center,
        zoom: hasPin ? SELECTED_ZOOM : DEFAULT_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });

      this.webMap.addListener('click', (event: google.maps.MapMouseEvent) => {
        const latLng = event.latLng;
        if (latLng === null || this.syncingFromParent) return;
        const pick = { latitude: latLng.lat(), longitude: latLng.lng() };
        void this.placeWebPin(pick.latitude, pick.longitude, false);
        this.locationPicked.emit(pick);
      });

      if (hasPin) await this.placeWebPin(latitude, longitude, false);
      this.initialized = true;
    } catch {
      this.unavailable.set(true);
      this.hint.set('Could not load Google Maps.');
    }
  }

  /** Creates a Capacitor Google Map using the Android-restricted key. */
  private async initAndroidMap(): Promise<void> {
    const host = this.mapCanvas()?.nativeElement;
    if (host === undefined) {
      this.unavailable.set(true);
      return;
    }

    try {
      const { apiKey } = await MapsKey.getAndroidMapsApiKey();
      if (apiKey.trim().length === 0) {
        this.unavailable.set(true);
        this.hint.set('Map requires GOOGLE_MAPS_ANDROID_API_KEY.');
        return;
      }

      const latitude = this.latitude();
      const longitude = this.longitude();
      const hasPin = latitude !== undefined && longitude !== undefined;

      this.nativeMap = await GoogleMap.create({
        id: 'event-location-map',
        element: host,
        apiKey,
        config: {
          center: hasPin
            ? { lat: latitude, lng: longitude }
            : DEFAULT_CENTER,
          zoom: hasPin ? SELECTED_ZOOM : DEFAULT_ZOOM,
        },
      });

      await this.nativeMap.setOnMapClickListener((event) => {
        if (this.syncingFromParent) return;
        const pick = {
          latitude: event.latitude,
          longitude: event.longitude,
        };
        void this.placeNativePin(pick.latitude, pick.longitude, false);
        this.locationPicked.emit(pick);
      });

      await this.nativeMap.setOnMarkerDragEndListener((event) => {
        if (this.syncingFromParent) return;
        this.locationPicked.emit({
          latitude: event.latitude,
          longitude: event.longitude,
        });
      });

      if (hasPin) await this.placeNativePin(latitude, longitude, false);
      this.initialized = true;
    } catch {
      this.unavailable.set(true);
      this.hint.set('Could not load Google Maps on Android.');
    }
  }

  /**
   * Moves or clears the marker from parent-driven coordinates.
   *
   * @param latitude - Latitude, or undefined to clear.
   * @param longitude - Longitude, or undefined to clear.
   * @param fly - Whether to animate the camera.
   */
  private async applyCoordinates(
    latitude: number | undefined,
    longitude: number | undefined,
    fly: boolean,
  ): Promise<void> {
    if (this.platform === 'ios') return;
    if (latitude === undefined || longitude === undefined) {
      if (this.webMarker !== undefined) {
        this.webMarker.setMap(null);
        this.webMarker = undefined;
      }
      if (this.nativeMap !== undefined && this.nativeMarkerId !== undefined) {
        await this.nativeMap.removeMarker(this.nativeMarkerId);
        this.nativeMarkerId = undefined;
      }
      return;
    }

    if (this.platform === 'android') {
      await this.placeNativePin(latitude, longitude, fly);
      return;
    }
    await this.placeWebPin(latitude, longitude, fly);
  }

  /**
   * Ensures a draggable web marker exists at the coordinates.
   *
   * @param latitude - Latitude in decimal degrees.
   * @param longitude - Longitude in decimal degrees.
   * @param fly - Whether to animate the camera to the pin.
   */
  private async placeWebPin(
    latitude: number,
    longitude: number,
    fly: boolean,
  ): Promise<void> {
    if (this.webMap === undefined) return;
    const position = { lat: latitude, lng: longitude };

    if (this.webMarker === undefined) {
      this.webMarker = new google.maps.Marker({
        map: this.webMap,
        position,
        draggable: true,
      });
      this.webMarker.addListener('dragend', () => {
        const next = this.webMarker?.getPosition();
        if (next === undefined || next === null || this.syncingFromParent) return;
        this.locationPicked.emit({
          latitude: next.lat(),
          longitude: next.lng(),
        });
      });
    } else {
      this.webMarker.setPosition(position);
    }

    if (fly) {
      this.webMap.panTo(position);
      this.webMap.setZoom(SELECTED_ZOOM);
    } else {
      this.webMap.setCenter(position);
      this.webMap.setZoom(Math.max(this.webMap.getZoom() ?? DEFAULT_ZOOM, SELECTED_ZOOM));
    }
  }

  /**
   * Ensures a draggable Android marker exists at the coordinates.
   *
   * @param latitude - Latitude in decimal degrees.
   * @param longitude - Longitude in decimal degrees.
   * @param fly - Whether to animate the camera to the pin.
   */
  private async placeNativePin(
    latitude: number,
    longitude: number,
    fly: boolean,
  ): Promise<void> {
    if (this.nativeMap === undefined) return;

    if (this.nativeMarkerId !== undefined) {
      await this.nativeMap.removeMarker(this.nativeMarkerId);
      this.nativeMarkerId = undefined;
    }

    this.nativeMarkerId = await this.nativeMap.addMarker({
      coordinate: { lat: latitude, lng: longitude },
      draggable: true,
    });

    await this.nativeMap.setCamera({
      coordinate: { lat: latitude, lng: longitude },
      zoom: SELECTED_ZOOM,
      animate: fly,
    });
  }
}

/**
 * Web map pin using the Maps JavaScript API when a browser key is configured.
 */

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { config } from './config';

type MapPick = { latitude: number; longitude: number };

/** The one in-flight or finished script load, shared by every map on the page. */
let mapsScript: Promise<GoogleMaps> | undefined;

/**
 * Loads the Maps JavaScript API once and resolves when it is ready.
 *
 * A map that mounts while the script is still downloading waits on the same
 * promise instead of drawing too early. A failed load is forgotten so the next
 * map can try again.
 *
 * @param key - The browser API key.
 * @returns The `google.maps` namespace.
 */
const loadGoogleMaps = (key: string): Promise<GoogleMaps> => {
  const ready = (window as unknown as { google?: { maps?: GoogleMaps } }).google?.maps;
  if (ready !== undefined) return Promise.resolve(ready);
  mapsScript ??= new Promise<GoogleMaps>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
    script.async = true;
    script.dataset.gameplanMaps = '1';
    script.onload = () => {
      const maps = (window as unknown as { google?: { maps?: GoogleMaps } }).google?.maps;
      if (maps === undefined) reject(new Error('maps_unavailable'));
      else resolve(maps);
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('maps_unavailable'));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    mapsScript = undefined;
    throw error;
  });
  return mapsScript;
};

/**
 * Shows a map the user can click to choose a coordinate.
 */
export const MapPicker = ({
  latitude,
  longitude,
  onPick,
  readOnly = false,
}: {
  latitude?: number;
  longitude?: number;
  onPick?: (pick: MapPick) => void;
  readOnly?: boolean;
}) => {
  const host = useRef<HTMLDivElement | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const key = config.googleMapsApiKey;
    const node = host.current;
    if (key.length === 0 || node === null) return;
    const start = { lat: latitude ?? 40.7, lng: longitude ?? -74 };
    let cancelled = false;

    const draw = (maps: GoogleMaps): void => {
      if (cancelled) return;
      const map = new maps.Map(node, { center: start, zoom: 12 });
      const marker = new maps.Marker({ position: start, map });
      if (readOnly) return;
      map.addListener('click', (event: { latLng?: { lat: () => number; lng: () => number } }) => {
        const lat = event.latLng?.lat();
        const lng = event.latLng?.lng();
        if (lat === undefined || lng === undefined) return;
        marker.setPosition({ lat, lng });
        onPickRef.current?.({ latitude: lat, longitude: lng });
      });
    };

    setFailed(false);
    loadGoogleMaps(key).then(draw, () => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, readOnly]);

  if (config.googleMapsApiKey.length === 0 || failed) {
    return <Text className="mb-2 text-muted">Map unavailable</Text>;
  }

  return (
    <View className="mb-3 h-48 overflow-hidden rounded-lg">
      <div ref={host} style={{ height: 192, width: '100%' }} />
    </View>
  );
};

type GoogleMaps = {
  Map: new (node: HTMLElement, options: { center: { lat: number; lng: number }; zoom: number }) => {
    addListener: (event: string, handler: (event: { latLng?: { lat: () => number; lng: () => number } }) => void) => void;
  };
  Marker: new (options: { position: { lat: number; lng: number }; map: unknown }) => {
    setPosition: (position: { lat: number; lng: number }) => void;
  };
};

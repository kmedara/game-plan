/**
 * Web map pin using the Maps JavaScript API when a browser key is configured.
 */

import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import { config } from './config';

type MapPick = { latitude: number; longitude: number };

/**
 * Shows a map the user can click to choose a coordinate.
 */
export const MapPicker = ({
  latitude,
  longitude,
  onPick,
}: {
  latitude?: number;
  longitude?: number;
  onPick: (pick: MapPick) => void;
}) => {
  const host = useRef<HTMLDivElement | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const key = config.googleMapsApiKey;
    const node = host.current;
    if (key.length === 0 || node === null) return;
    const start = { lat: latitude ?? 40.7, lng: longitude ?? -74 };
    let cancelled = false;

    const draw = (): void => {
      if (cancelled) return;
      const maps = (window as unknown as { google?: { maps: GoogleMaps } }).google?.maps;
      if (maps === undefined) return;
      const map = new maps.Map(node, { center: start, zoom: 12 });
      const marker = new maps.Marker({ position: start, map });
      map.addListener('click', (event: { latLng?: { lat: () => number; lng: () => number } }) => {
        const lat = event.latLng?.lat();
        const lng = event.latLng?.lng();
        if (lat === undefined || lng === undefined) return;
        marker.setPosition({ lat, lng });
        onPickRef.current({ latitude: lat, longitude: lng });
      });
    };

    const existing = document.querySelector('script[data-gameplan-maps]');
    if (existing !== null) {
      draw();
      return () => {
        cancelled = true;
      };
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
    script.async = true;
    script.dataset.gameplanMaps = '1';
    script.onload = draw;
    document.head.appendChild(script);
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude]);

  if (config.googleMapsApiKey.length === 0) {
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

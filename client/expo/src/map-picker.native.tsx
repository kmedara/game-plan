/**
 * Native map pin using react-native-maps.
 */

import { useState } from 'react';
import { View } from 'react-native';
import MapView, { Marker, type MapPressEvent } from 'react-native-maps';

type MapPick = { latitude: number; longitude: number };

/**
 * Shows a native map the user can tap to choose a coordinate.
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
  const [pin, setPin] = useState<MapPick>({
    latitude: latitude ?? 40.7,
    longitude: longitude ?? -74,
  });

  const press = (event: MapPressEvent): void => {
    const next = event.nativeEvent.coordinate;
    setPin(next);
    onPick?.(next);
  };

  return (
    <View className="mb-3 h-48 overflow-hidden rounded-xl border border-line">
      <MapView
        style={{ height: 192, width: '100%' }}
        initialRegion={{ ...pin, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        onPress={readOnly ? undefined : press}
        scrollEnabled={!readOnly}
        zoomEnabled={!readOnly}
      >
        <Marker coordinate={pin} />
      </MapView>
    </View>
  );
};

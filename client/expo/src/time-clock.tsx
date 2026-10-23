/**
 * Web clock input. The value is minutes from midnight.
 */

import { View } from 'react-native';
import { clockFromMinutes } from './schedule-calendar';
import { colors } from './theme';

export const TimeClock = ({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  onDismiss?: () => void;
}) => (
  <View className="w-full self-stretch rounded-xl border border-line bg-inset">
    <input
      type="time"
      value={clockFromMinutes(minutes)}
      onChange={(event) => {
        const [hour, minute] = event.currentTarget.value.split(':').map(Number);
        if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) return;
        onChange(hour * 60 + minute);
      }}
      style={{
        display: 'block',
        width: '100%',
        boxSizing: 'border-box',
        minWidth: 0,
        border: 'none',
        backgroundColor: 'transparent',
        padding: '8px 12px',
        fontSize: 16,
        color: colors.ink,
      }}
    />
  </View>
);

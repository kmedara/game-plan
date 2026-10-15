/**
 * Native clock. Opens the platform time picker and reports minutes from midnight.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

export const TimeClock = ({
  minutes,
  onChange,
  onDismiss,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  onDismiss?: () => void;
}) => {
  const value = new Date();
  value.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return (
    <DateTimePicker
      value={value}
      mode="time"
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      onChange={(event, next) => {
        if (Platform.OS !== 'ios') onDismiss?.();
        if (event.type === 'dismissed' || next === undefined) return;
        onChange(next.getHours() * 60 + next.getMinutes());
      }}
    />
  );
};

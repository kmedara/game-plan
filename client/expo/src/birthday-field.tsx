/**
 * Web birthday row using the browser date input. The stored value is `YYYY-MM-DD`.
 */

import { Text, View } from 'react-native';
import { toIsoDate } from './birthday';

export const BirthdayField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <View className="mb-3">
    <Text className="mb-1 text-sm text-muted">{label}</Text>
    <input
      type="date"
      max={toIsoDate(new Date())}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      style={{
        width: '100%',
        borderRadius: 12,
        border: '1px solid #c5d0c9',
        backgroundColor: '#e4ebe6',
        padding: '8px 12px',
        fontSize: 16,
        color: '#101412',
      }}
    />
  </View>
);

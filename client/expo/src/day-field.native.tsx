/**
 * Native civil-date row. Opens the platform date picker and stores `YYYY-MM-DD`.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, Text } from 'react-native';

export const DayField = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (dayKey: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const selected = value.length > 0 ? fromDayKey(value) : new Date();
  return (
    <>
      <Pressable
        className="rounded-xl border border-line bg-inset px-3 py-2"
        onPress={() => setOpen((current) => !current)}
      >
        <Text className="text-base text-ink">{value.length === 0 ? '—' : value}</Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={selected}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, next) => {
            if (Platform.OS !== 'ios') setOpen(false);
            if (event.type === 'dismissed' || next === undefined) return;
            const month = String(next.getMonth() + 1).padStart(2, '0');
            const day = String(next.getDate()).padStart(2, '0');
            onChange(`${next.getFullYear()}-${month}-${day}`);
          }}
        />
      ) : null}
    </>
  );
};

const fromDayKey = (dayKey: string): Date => {
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
};

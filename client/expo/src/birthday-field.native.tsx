/**
 * Native birthday row. Opens the platform date picker and stores `YYYY-MM-DD`.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatBirthday, parseIsoDate, toIsoDate } from './birthday';

export const BirthdayField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = value.length > 0 ? parseIsoDate(value) : yearsAgo(18);

  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-muted">{label}</Text>
      <Pressable
        className="rounded-xl border border-line bg-inset px-3 py-2"
        onPress={() => setOpen((current) => !current)}
      >
        <Text className={value.length === 0 ? 'text-base text-muted' : 'text-base text-ink'}>
          {value.length === 0 ? t('completeProfile.chooseBirthday') : formatBirthday(value, i18n.language)}
        </Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={selected}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={(event, next) => {
            if (Platform.OS !== 'ios') setOpen(false);
            if (event.type === 'dismissed' || next === undefined) return;
            onChange(toIsoDate(next));
          }}
        />
      ) : null}
    </View>
  );
};

const yearsAgo = (years: number): Date => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
};

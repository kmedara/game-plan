/**
 * Birthday as month, day, and year boxes. The stored value is `YYYY-MM-DD`.
 */

import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View, type TextInputInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { birthdayPartOrder, composeBirthday, splitBirthday, type BirthdayPart } from './birthday';

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
  const [parts, setParts] = useState(splitBirthday(value));
  const order = birthdayPartOrder(i18n.language);
  const inputs = useRef<Partial<Record<BirthdayPart, TextInputInstance | null>>>({});

  useEffect(() => {
    if (value.length === 0) return;
    setParts(splitBirthday(value));
  }, [value]);

  const edit = (part: BirthdayPart, next: string): void => {
    const limit = part === 'year' ? 4 : 2;
    const digits = next.replace(/\D/g, '').slice(0, limit);
    const updated = { ...parts, [part]: digits };
    setParts(updated);
    onChange(composeBirthday(updated.month, updated.day, updated.year) ?? '');
    if (digits.length < limit) return;
    const nextPart = order[order.indexOf(part) + 1];
    if (nextPart !== undefined) inputs.current[nextPart]?.focus();
  };

  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-muted">{label}</Text>
      <View className="flex-row gap-2">
        {order.map((part) => (
          <View key={part} className={part === 'year' ? 'flex-1' : 'w-20'}>
            <Text className="mb-1 text-xs text-muted">{t(`completeProfile.${part}`)}</Text>
            <TextInput
              ref={(node) => {
                inputs.current[part] = node;
              }}
              className="rounded-xl border border-line bg-inset px-3 py-2 text-base text-ink"
              value={parts[part]}
              onChangeText={(next) => edit(part, next)}
              placeholder={part === 'year' ? 'YYYY' : part === 'month' ? 'MM' : 'DD'}
              inputMode="numeric"
              maxLength={part === 'year' ? 4 : 2}
              keyboardType="number-pad"
            />
          </View>
        ))}
      </View>
    </View>
  );
};

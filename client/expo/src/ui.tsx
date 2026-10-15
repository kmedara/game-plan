/**
 * Small form controls shared by the screens.
 */

import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { searchTimeZones, timeZoneLabel } from './time-zones';

export const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) => (
  <View className="mb-3">
    <Text className="mb-1 text-sm text-slate-600">{label}</Text>
    <TextInput
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      autoCapitalize="none"
    />
  </View>
);

export const TimeZoneField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) return;
    setQuery(value.length === 0 ? '' : timeZoneLabel(value));
  }, [open, value]);

  const choices = open ? searchTimeZones(query) : [];

  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-slate-600">{label}</Text>
      <TextInput
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
        value={query}
        onChangeText={(next) => {
          setQuery(next);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery(value);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {choices.map((choice) => (
        <Pressable
          key={choice.id}
          className="border-x border-b border-slate-200 bg-white px-3 py-2"
          onPressIn={() => {
            onChange(choice.id);
            setQuery(choice.label);
            setOpen(false);
          }}
        >
          <Text className="text-slate-900">{choice.label}</Text>
        </Pressable>
      ))}
    </View>
  );
};

export const Button = ({
  label,
  onPress,
  disabled,
  color,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}) => (
  <Pressable
    className="mb-2 items-center rounded-lg px-4 py-3"
    style={{ backgroundColor: disabled ? '#94a3b8' : (color ?? '#0f766e') }}
    onPress={onPress}
    disabled={disabled}
  >
    <Text className="font-semibold text-white">{label}</Text>
  </Pressable>
);

export const ErrorText = ({ message }: { message: string | undefined }) =>
  message === undefined ? null : <Text className="mb-2 text-red-700">{message}</Text>;

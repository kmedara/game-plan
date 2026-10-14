/**
 * Small form controls shared by the screens.
 */

import { Pressable, Text, TextInput, View } from 'react-native';

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

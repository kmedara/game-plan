/**
 * Small form controls shared by the screens.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useApp } from './state';
import { colors, fieldWash, muteColor } from './theme';
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
    <Text className="mb-1 text-sm text-muted">{label}</Text>
    <TextInput
      className="rounded-xl border border-line bg-inset px-3 py-2 text-base text-ink"
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
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelClose = (): void => {
    if (closing.current === undefined) return;
    clearTimeout(closing.current);
    closing.current = undefined;
  };

  useEffect(() => {
    if (open) return;
    setQuery(value.length === 0 ? '' : timeZoneLabel(value));
  }, [open, value]);

  const choices = open ? searchTimeZones(query, new Date(), 400) : [];

  return (
    <View className="mb-3" style={{ zIndex: open ? 20 : 0 }}>
      <Text className="mb-1 text-sm text-muted">{label}</Text>
      <View>
        <TextInput
          className="rounded-xl border border-line bg-inset px-3 py-2 text-base text-ink"
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery(value);
            setOpen(true);
          }}
          onBlur={() => {
            cancelClose();
            closing.current = setTimeout(() => setOpen(false), 150);
          }}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {choices.length > 0 ? (
        <ScrollView
          className="absolute left-0 right-0 top-full z-20 max-h-60 rounded-xl border border-line bg-paper"
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          onTouchStart={cancelClose}
          onMouseDown={(event) => {
            event.preventDefault();
            cancelClose();
          }}
        >
          {choices.map((choice) => (
            <Pressable
              key={choice.id}
              className="border-b border-line px-3 py-2"
              onPressIn={() => {
                cancelClose();
                onChange(choice.id);
                setQuery(choice.label);
                setOpen(false);
              }}
            >
              <Text className="text-ink">{choice.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        ) : null}
      </View>
    </View>
  );
};

export type ButtonTone = 'primary' | 'secondary' | 'danger';

export const Button = ({
  label,
  onPress,
  disabled,
  color,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  tone?: ButtonTone;
}) => {
  const { brand } = useApp();
  const [pressed, setPressed] = useState(false);
  const source = color ?? brand.primary;
  const fill = fieldWash(muteColor(source), 0.75);
  const surface = tone === 'secondary' ? 'border border-line bg-inset' : '';
  return (
    <Pressable
      className={`mb-2 min-h-11 w-full items-center justify-center overflow-hidden rounded-full px-5 ${surface}`}
      style={
        tone === 'danger'
          ? { opacity: disabled ? 0.4 : pressed ? 0.85 : 1 }
          : {
              backgroundColor: tone === 'secondary' ? colors.inset : pressed ? muteColor(source) : fill,
              opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
            }
      }
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
    >
      <Text
        className={`font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'secondary' ? '' : 'text-white'}`}
        style={tone === 'secondary' ? { color: brand.secondary } : { color: tone === 'danger' ? colors.danger : '#ffffff' }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

export const ErrorText = ({ message }: { message: string | undefined }) =>
  message === undefined ? null : <Text className="mb-2 text-danger">{message}</Text>;

const responseMessage = (err: unknown): string =>
  err instanceof Error && err.message.length > 0 ? err.message : 'request_failed';

/**
 * Form submit control. Runs `onPress`, and shows the thrown response message under the button.
 */
export const SubmitButton = ({
  label,
  onPress,
  disabled,
  color,
  tone,
  message,
}: {
  label: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  color?: string;
  tone?: ButtonTone;
  message?: (err: unknown) => string;
}) => {
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setError(undefined);
    setBusy(true);
    try {
      await onPress();
    } catch (err) {
      setError((message ?? responseMessage)(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Button label={label} onPress={() => void submit()} disabled={disabled === true || busy} color={color} tone={tone} />
      <ErrorText message={error} />
    </View>
  );
};

const initialsFor = (name: string | undefined): string =>
  (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** Fixed-size avatar. Initials hold the space until the photo fades in. */
export const ProfilePhoto = ({ name, uri }: { name: string | undefined; uri: string | undefined }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const [loadedUri, setLoadedUri] = useState<string | undefined>();
  const visible = uri !== undefined && loadedUri === uri;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 0,
      useNativeDriver: true,
    }).start();
  }, [opacity, visible]);

  return (
    <View className="h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-line">
      <Text className="text-2xl font-semibold text-muted">{initialsFor(name)}</Text>
      {uri !== undefined ? (
        <Animated.View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity }}>
          <Image
            source={{ uri }}
            accessibilityLabel={name}
            onLoad={() => setLoadedUri(uri)}
            style={{ width: 96, height: 96 }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
};

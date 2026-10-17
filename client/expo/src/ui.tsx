/**
 * Small form controls shared by the screens.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Platform, Pressable, ScrollView, type ScrollViewProps, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from './errors';
import { useApp } from './state';
import { colors, fieldWash, fieldWashOpacity, muteColor } from './theme';
import { searchTimeZones, timeZoneLabel } from './time-zones';

export const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
}) => (
  <View className="mb-3">
    <Text className="mb-1 text-sm text-muted">{label}</Text>
    <TextInput
      className={`rounded-xl border border-line bg-inset px-3 py-2 text-base text-ink${multiline === true ? ' min-h-24' : ''}`}
      value={value}
      onChangeText={onChangeText}
      accessibilityLabel={label}
      placeholder={placeholder}
      autoCapitalize={multiline === true ? 'sentences' : 'none'}
      multiline={multiline}
      keyboardType={keyboardType}
      textAlignVertical={multiline === true ? 'top' : undefined}
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
          {...(Platform.OS === 'web'
            ? ({
                onMouseDown: (event: { preventDefault: () => void }) => {
                  event.preventDefault();
                  cancelClose();
                },
              } as unknown as ScrollViewProps)
            : null)}
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
  busy = false,
  labelOpacity,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  tone?: ButtonTone;
  busy?: boolean;
  labelOpacity?: Animated.Value;
}) => {
  const { brand } = useApp();
  const [pressed, setPressed] = useState(false);
  const source = color ?? brand.primary;
  const fill = fieldWash(muteColor(source), fieldWashOpacity.button);
  const surface = tone === 'secondary' ? 'border border-line bg-inset' : '';
  const labelColor = tone === 'secondary' ? brand.secondary : tone === 'danger' ? colors.danger : '#ffffff';
  const dimmed = disabled === true && !busy;
  return (
    <Pressable
      className={`mb-2 min-h-11 w-full items-center justify-center overflow-hidden rounded-full px-5 ${surface}`}
      style={
        tone === 'danger'
          ? { opacity: dimmed ? 0.4 : pressed && !busy ? 0.85 : 1 }
          : {
              backgroundColor: tone === 'secondary' ? colors.inset : pressed && !busy ? muteColor(source) : fill,
              opacity: dimmed ? 0.4 : pressed && !busy ? 0.85 : 1,
            }
      }
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled === true || busy}
    >
      {busy ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Animated.View style={{ opacity: labelOpacity }}>
          <Text
            className={`font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'secondary' ? '' : 'text-white'}`}
            style={{ color: labelColor }}
          >
            {label}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
};

export const ErrorText = ({ message }: { message: string | undefined }) =>
  message === undefined ? null : <Text className="mb-2 text-danger">{message}</Text>;

/**
 * Form submit control. Shows a loader on the button, then a confirmation or the thrown error.
 * Without `message`, the error shows the shared sentence for its code.
 * An empty `loadedText` keeps the original label after a successful press.
 */
export const SubmitButton = ({
  label,
  onPress,
  disabled,
  color,
  tone,
  message,
  loadedText,
}: {
  label: string;
  onPress: () => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  color?: string;
  tone?: ButtonTone;
  message?: (err: unknown) => string;
  loadedText?: string;
}) => {
  const { t } = useTranslation();
  const confirmation = loadedText ?? t('common.saved');
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const labelOpacity = useRef(new Animated.Value(1)).current;
  const hideSaved = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    if (hideSaved.current !== undefined) clearTimeout(hideSaved.current);
  }, []);

  const showSaved = (): void => {
    labelOpacity.setValue(0);
    Animated.timing(labelOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    hideSaved.current = setTimeout(() => {
      Animated.timing(labelOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        setSaved(false);
        Animated.timing(labelOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      });
    }, 1600);
  };

  const submit = async (): Promise<void> => {
    if (hideSaved.current !== undefined) clearTimeout(hideSaved.current);
    setError(undefined);
    setSaved(false);
    labelOpacity.setValue(1);
    setBusy(true);
    try {
      const confirmed = await onPress();
      if (confirmed !== false && confirmation.length > 0) {
        setSaved(true);
        showSaved();
      }
    } catch (err) {
      setError(message !== undefined ? message(err) : t(errorMessageKey(err, 'errors.common.requestFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Button
        label={saved ? confirmation : label}
        onPress={() => void submit()}
        disabled={disabled}
        color={color}
        tone={tone}
        busy={busy}
        labelOpacity={labelOpacity}
      />
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
export const ProfilePhoto = ({
  name,
  uri,
  size = 96,
  resizeMode = 'cover',
}: {
  name: string | undefined;
  uri: string | undefined;
  size?: number;
  resizeMode?: 'cover' | 'contain';
}) => {
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
    <View
      className="items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      <View
        className="absolute items-center justify-center rounded-full bg-line"
        style={{ width: size, height: size, opacity: visible ? 0 : 1 }}
      >
        <Text className={size >= 96 ? 'text-2xl font-semibold text-muted' : 'text-sm font-semibold text-muted'}>{initialsFor(name)}</Text>
      </View>
      {uri !== undefined ? (
        <Animated.View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity }}>
          <Image
            source={{ uri }}
            accessibilityLabel={name}
            resizeMode={resizeMode}
            onLoad={() => setLoadedUri(uri)}
            style={{ width: size, height: size }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
};

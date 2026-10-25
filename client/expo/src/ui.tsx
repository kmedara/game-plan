/**
 * Small form controls shared by the screens.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, type ScrollViewProps, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from './errors';
import { useApp } from './state';
import { colors, fieldWash, fieldWashOpacity, muteColor } from './theme';
import { searchTimeZones, timeZoneLabel } from './time-zones';

/** Compact save control that sits inside a text field once the value has changed. */
const FieldSave = ({ onPress }: { onPress: () => void | Promise<void> }) => {
  const { t } = useTranslation();
  const { brand } = useApp();
  const [busy, setBusy] = useState(false);

  const press = (): void => {
    if (busy) return;
    setBusy(true);
    void Promise.resolve(onPress()).finally(() => setBusy(false));
  };

  return (
    <Pressable
      className="mr-1.5 items-center justify-center rounded-lg px-2 py-1"
      onPress={press}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={t('common.save')}
    >
      {busy ? (
        <ActivityIndicator size="small" color={brand.accent} />
      ) : (
        <Text className="text-sm font-semibold" style={{ color: brand.accent }}>
          {t('common.save')}
        </Text>
      )}
    </Pressable>
  );
};

export const Field = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  onSave,
  hideLabel,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'decimal-pad';
  /** Shown inside the field when the caller has something to store. */
  onSave?: () => void | Promise<void>;
  /** Leaves the label off screen. It still names the field for screen readers. */
  hideLabel?: boolean;
}) => (
  <View className="mb-3">
    {hideLabel === true ? null : <Text className="mb-1 text-base text-muted">{label}</Text>}
    <View className={`flex-row rounded-xl border border-line bg-inset${multiline === true ? ' items-end' : ' items-center'}`}>
      <TextInput
        className={`min-w-0 flex-1 px-3 py-2 text-base text-ink${multiline === true ? ' min-h-24' : ''}`}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        autoCapitalize={multiline === true ? 'sentences' : 'none'}
        multiline={multiline}
        keyboardType={keyboardType}
        textAlignVertical={multiline === true ? 'top' : undefined}
      />
      {onSave !== undefined ? <FieldSave onPress={onSave} /> : null}
    </View>
  </View>
);

/** One row in an {@link AutocompleteField} list. */
export type AutocompleteChoice = {
  id: string;
  label: string;
  /** Shown dimmed under the label and makes the row unpickable, such as why it cannot be chosen. */
  disabledReason?: string;
};

/**
 * Text field that lists matching choices underneath while it has focus.
 *
 * @param props.text - What the field shows while closed, such as the picked label.
 * @param props.focusText - What the field holds once focused. Defaults to `text`.
 * @param props.search - Choices for the typed query.
 * @param props.onPick - Called with the tapped choice. The list then closes.
 */
export const AutocompleteField = ({
  label,
  text,
  focusText,
  search,
  onPick,
  placeholder,
  onSave,
}: {
  label: string;
  text: string;
  focusText?: string;
  search: (query: string) => AutocompleteChoice[];
  onPick: (choice: AutocompleteChoice) => void;
  placeholder?: string;
  /** Shown inside the field when the caller has something to store. */
  onSave?: () => void | Promise<void>;
}) => {
  const [query, setQuery] = useState(text);
  const [open, setOpen] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelClose = (): void => {
    if (closing.current === undefined) return;
    clearTimeout(closing.current);
    closing.current = undefined;
  };

  useEffect(() => {
    if (open) return;
    setQuery(text);
  }, [open, text]);

  const choices = open ? search(query) : [];

  return (
    <View className="mb-3" style={{ zIndex: open ? 20 : 0 }}>
      <Text className="mb-1 text-base text-muted">{label}</Text>
      <View>
        <View className="flex-row items-center rounded-xl border border-line bg-inset">
          <TextInput
            className="min-w-0 flex-1 px-3 py-2 text-base text-ink"
            value={query}
            accessibilityLabel={label}
            placeholder={placeholder}
            onChangeText={(next) => {
              setQuery(next);
              setOpen(true);
            }}
            onFocus={() => {
              setQuery(focusText ?? text);
              setOpen(true);
            }}
            onBlur={() => {
              cancelClose();
              closing.current = setTimeout(() => setOpen(false), 150);
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {onSave !== undefined ? <FieldSave onPress={onSave} /> : null}
        </View>
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
              disabled={choice.disabledReason !== undefined}
              accessibilityState={{ disabled: choice.disabledReason !== undefined }}
              onPressIn={() => {
                cancelClose();
                if (choice.disabledReason !== undefined) return;
                onPick(choice);
                setOpen(false);
              }}
            >
              <Text className={`text-base${choice.disabledReason !== undefined ? ' text-muted' : ' text-ink'}`}>{choice.label}</Text>
              {choice.disabledReason !== undefined ? (
                <Text className="text-sm text-muted">{choice.disabledReason}</Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
        ) : null}
      </View>
    </View>
  );
};

export const TimeZoneField = ({
  label,
  value,
  onChange,
  onSave,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown inside the field when the selected zone is not the saved one. */
  onSave?: () => void | Promise<void>;
}) => (
  <AutocompleteField
    label={label}
    text={value.length === 0 ? '' : timeZoneLabel(value)}
    focusText={value}
    search={(query) => searchTimeZones(query, new Date(), 400)}
    onPick={(choice) => onChange(choice.id)}
    onSave={onSave}
  />
);

/** A selectable pill. Use {@link equal} when the chip sits in an {@link EqualChipRow}. */
export const Chip = ({
  label,
  selected,
  onPress,
  equal,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  equal?: boolean;
}) => {
  const { brand } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={
        equal
          ? 'min-w-0 flex-1 items-center justify-center rounded-full border px-2 py-2'
          : 'mb-2 mr-2 shrink-0 rounded-full border px-3 py-1'
      }
      style={{ borderColor: selected ? brand.primary : colors.line, backgroundColor: selected ? brand.primary : colors.paper }}
      onPress={onPress}
    >
      <Text
        className={equal ? 'text-center text-sm' : undefined}
        numberOfLines={equal ? 2 : undefined}
        style={{ color: selected ? brand.onPrimary : colors.ink }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

/** Two (or few) chips in one row, each taking equal width. */
export const EqualChipRow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <View className={`flex-row gap-2${className !== undefined ? ` ${className}` : ''}`}>{children}</View>
);

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
  message === undefined ? null : <Text className="mb-2 text-base text-danger">{message}</Text>;

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
            contentFit={resizeMode}
            onLoad={() => setLoadedUri(uri)}
            style={{ width: size, height: size }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
};

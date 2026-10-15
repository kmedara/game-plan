/**
 * Compact team color picker. The shell header shows the draft colors.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { createElement, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useApp } from './state';

const HUE_STOPS = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'] as const;
const DEFAULT_SECONDARY = '#1e3a8a';
const DEFAULT_ACCENT = '#ea580c';

const hslToHex = (hue: number, lightness: number): string => {
  const saturation = 0.72;
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number): string => {
    const k = (offset + hue / 30) % 12;
    const value = lightness - chroma * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * value).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

const fraction = (location: number, width: number): number => {
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, location / width));
};

const WebWell = ({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) => {
  const shown = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#0a6e38';
  return (
    <View className="h-9 w-9 overflow-hidden rounded-full border border-line" style={{ backgroundColor: shown }}>
      {createElement('input', {
        type: 'color',
        'aria-label': label,
        value: shown,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: 36,
          height: 36,
          opacity: 0,
          padding: 0,
          border: 'none',
          cursor: 'pointer',
        },
      })}
    </View>
  );
};

const NativeBars = ({
  label,
  onChange,
}: {
  label: string;
  onChange: (value: string) => void;
}) => {
  const [hue, setHue] = useState(140);
  const [lightness, setLightness] = useState(0.4);
  const [width, setWidth] = useState(1);

  return (
    <View className="mb-3 gap-2" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Pressable
        accessibilityLabel={label}
        onPress={(event) => {
          const nextHue = Math.round(fraction(event.nativeEvent.locationX, width) * 360);
          setHue(nextHue);
          onChange(hslToHex(nextHue, lightness));
        }}
      >
        <LinearGradient colors={[...HUE_STOPS]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 28, borderRadius: 14 }} />
      </Pressable>
      <Pressable
        accessibilityLabel={label}
        onPress={(event) => {
          const nextLightness = 0.9 - fraction(event.nativeEvent.locationX, width) * 0.75;
          setLightness(nextLightness);
          onChange(hslToHex(hue, nextLightness));
        }}
      >
        <LinearGradient
          colors={['#f7f9f8', hslToHex(hue, 0.45), '#101412']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ height: 28, borderRadius: 14 }}
        />
      </Pressable>
    </View>
  );
};

const ColorWell = ({
  label,
  value,
  onChange,
  onClear,
  linkColor,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  linkColor: string;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const shown = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#0a6e38';
  return (
    <View className="items-center">
      {Platform.OS === 'web' ? (
        <WebWell value={value} label={label} onChange={onChange} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => setOpen((current) => !current)}
          className="h-9 w-9 rounded-full border border-line"
          style={{ backgroundColor: shown }}
        />
      )}
      <Text className="mt-1 text-sm text-ink">{label}</Text>
      {onClear !== undefined ? (
        <Pressable onPress={onClear} accessibilityRole="button">
          <Text className="text-sm" style={{ color: linkColor }}>{t('teamAdmin.removeColor')}</Text>
        </Pressable>
      ) : null}
      {Platform.OS !== 'web' && open ? <NativeBars label={label} onChange={onChange} /> : null}
    </View>
  );
};

export const TeamColors = ({
  primary,
  secondary,
  accent,
  onChange,
}: {
  primary: string;
  secondary: string;
  accent: string;
  onChange: (next: { primary: string; secondary: string; accent: string }) => void;
}) => {
  const { t } = useTranslation();
  const { brand } = useApp();

  return (
    <View className="mb-3 w-full flex-row items-start justify-around">
      <ColorWell label={t('teamAdmin.primary')} value={primary} linkColor={brand.secondary} onChange={(value) => onChange({ primary: value, secondary, accent })} />
      {secondary.length > 0 ? (
        <ColorWell
          label={t('teamAdmin.secondary')}
          value={secondary}
          linkColor={brand.secondary}
          onChange={(value) => onChange({ primary, secondary: value, accent })}
          onClear={() => onChange({ primary, secondary: '', accent })}
        />
      ) : (
        <Pressable className="items-center" onPress={() => onChange({ primary, secondary: DEFAULT_SECONDARY, accent })} accessibilityRole="button">
          <View className="h-9 w-9 items-center justify-center rounded-full border border-line">
            <View className="h-3.5 w-3.5 items-center justify-center">
              <View className="absolute h-0.5 w-3.5 rounded-full bg-ink" />
              <View className="absolute h-3.5 w-0.5 rounded-full bg-ink" />
            </View>
          </View>
          <Text className="mt-1 text-sm text-ink">{t('teamAdmin.secondary')}</Text>
        </Pressable>
      )}
      {accent.length > 0 ? (
        <ColorWell
          label={t('teamAdmin.accent')}
          value={accent}
          linkColor={brand.secondary}
          onChange={(value) => onChange({ primary, secondary, accent: value })}
          onClear={() => onChange({ primary, secondary, accent: '' })}
        />
      ) : (
        <Pressable className="items-center" onPress={() => onChange({ primary, secondary, accent: DEFAULT_ACCENT })} accessibilityRole="button">
          <View className="h-9 w-9 items-center justify-center rounded-full border border-line">
            <View className="h-3.5 w-3.5 items-center justify-center">
              <View className="absolute h-0.5 w-3.5 rounded-full bg-ink" />
              <View className="absolute h-3.5 w-0.5 rounded-full bg-ink" />
            </View>
          </View>
          <Text className="mt-1 text-sm text-ink">{t('teamAdmin.accent')}</Text>
        </Pressable>
      )}
    </View>
  );
};

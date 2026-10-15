/**
 * Full-height sheet for multi-field forms. The header stays put while the body scrolls.
 */

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from './state';

export const Sheet = ({
  visible,
  title,
  closeLabel,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) => {
  const insets = useSafeAreaInsets();
  const { brand } = useApp();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="flex-row items-center border-b border-line bg-raised px-2 py-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            className="min-w-20 px-2 py-2"
            onPress={onClose}
          >
            <Text className="text-base" style={{ color: brand.secondary }}>{closeLabel}</Text>
          </Pressable>
          <Text className="flex-1 text-center text-base font-semibold text-ink" numberOfLines={1}>
            {title}
          </Text>
          <View className="min-w-20" />
        </View>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

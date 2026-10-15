/**
 * Single-choice role control. Each option is a pill.
 */

import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamRole } from '@gameplan/types';
import { roleLabel } from '@/src/roles';
import { useApp } from '@/src/state';

export const RolePicker = ({
  roles,
  value,
  onChange,
}: {
  roles: TeamRole[];
  value: TeamRole;
  onChange: (role: TeamRole) => void;
}) => {
  const { t } = useTranslation();
  const { brand } = useApp();

  return (
    <View className="flex-row flex-wrap">
      {roles.map((role) => {
        const selected = role === value;
        return (
          <Pressable
            key={role}
            className={`mb-2 mr-2 rounded-full px-3 py-1 ${selected ? '' : 'border border-line bg-paper'}`}
            style={selected ? { backgroundColor: brand.primary } : undefined}
            onPress={() => onChange(role)}
          >
            <Text className={selected ? 'text-sm font-semibold' : 'text-sm text-ink'} style={selected ? { color: brand.onPrimary } : undefined}>
              {t(roleLabel(role))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

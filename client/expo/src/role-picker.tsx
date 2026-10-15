/**
 * Single-choice role control. Each option is a pill.
 */

import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamRole } from '@gameplan/types';
import { roleLabel } from '@/src/roles';
import { useApp } from '@/src/state';
import { fieldWash, fieldWashOpacity } from '@/src/theme';

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
            className={`mb-2 mr-2 px-3 py-1 ${selected ? 'rounded-full' : ''}`}
            style={selected ? { backgroundColor: fieldWash(brand.primary, fieldWashOpacity.chip) } : undefined}
            onPress={() => onChange(role)}
          >
            <Text className="text-sm text-ink">
              {t(roleLabel(role))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

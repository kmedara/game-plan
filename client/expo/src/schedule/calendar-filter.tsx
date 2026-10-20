/**
 * Team and event-type chips above the calendar. The choice is remembered per device.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EVENT_TYPES, type EventType, type TeamSummary } from '@gameplan/types';
import { parseCalendarFilter, SHOW_ALL, type CalendarFilter } from '../athlete-schedule';
import { readPreference, writePreference } from '../refresh-store';
import { useApp } from '../state';
import { brandColors, colors } from '../theme';

/** Device storage key for the calendar filter. */
const CALENDAR_FILTER_KEY = 'calendar-filter';

/**
 * The calendar filter, loaded from and saved to device storage.
 *
 * @returns The current filter and a setter that also saves it.
 */
export const useCalendarFilter = (): [CalendarFilter, (next: CalendarFilter) => void] => {
  const { api } = useApp();
  const [filter, setFilter] = useState<CalendarFilter>(SHOW_ALL);
  useEffect(() => {
    void readPreference(CALENDAR_FILTER_KEY, api.native).then((raw) => setFilter(parseCalendarFilter(raw)));
  }, [api]);
  const update = (next: CalendarFilter): void => {
    setFilter(next);
    void writePreference(CALENDAR_FILTER_KEY, JSON.stringify(next), api.native);
  };
  return [filter, update];
};

/** Adds or removes one value from a hidden list. */
const toggled = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

const Chip = ({ label, on, color, onPress }: { label: string; on: boolean; color: string; onPress: () => void }) => (
  <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked: on }}
    className="mb-2 mr-2 flex-row items-center rounded-full border px-3 py-1"
    style={{ borderColor: on ? color : colors.line, opacity: on ? 1 : 0.5 }}
    onPress={onPress}
  >
    <View className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: on ? color : colors.line }} />
    <Text className="text-sm text-ink">{label}</Text>
  </Pressable>
);

/** Chips for each team (when there is more than one) and each event type. */
export const CalendarFilterChips = ({
  teams,
  filter,
  onChange,
}: {
  teams: readonly TeamSummary[];
  filter: CalendarFilter;
  onChange: (next: CalendarFilter) => void;
}) => {
  const { t } = useTranslation();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
      {teams.length > 1
        ? teams.map((team) => (
            <Chip
              key={team.teamId}
              label={team.name}
              on={!filter.hiddenTeamIds.includes(team.teamId)}
              color={brandColors(team.theme).accent}
              onPress={() => onChange({ ...filter, hiddenTeamIds: toggled(filter.hiddenTeamIds, team.teamId) })}
            />
          ))
        : null}
      {EVENT_TYPES.map((type: EventType) => (
        <Chip
          key={type}
          label={t(`eventType.${type}`)}
          on={!filter.hiddenEventTypes.includes(type)}
          color={colors.ink}
          onPress={() => onChange({ ...filter, hiddenEventTypes: toggled(filter.hiddenEventTypes, type) })}
        />
      ))}
    </ScrollView>
  );
};

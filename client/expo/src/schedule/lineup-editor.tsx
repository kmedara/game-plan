/**
 * Game lineup for one occurrence.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ScheduleOccurrence, TeamMember } from '@gameplan/types';
import { errorMessageKey, queryError } from '@/src/errors';
import { lineupMutation, lineupQuery } from '@/src/queries/schedule';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field, SubmitButton } from '@/src/ui';

export const LineupEditor = ({
  item,
  teamId,
  roster,
  canManage,
  nameOf,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  roster: TeamMember[];
  canManage: boolean;
  nameOf: (userId: string) => string;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const lineup = useQuery(lineupQuery(api, teamId, item.eventId, item.startsAt));
  const saveLineup = useMutation(lineupMutation(api, queryClient));
  const [slots, setSlots] = useState<typeof lineup.data>(undefined);
  const shownSlots = slots ?? lineup.data ?? [];
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const shown = error ?? (queryError(lineup.error) !== undefined ? t('errors.event.lineupLoadFailed') : undefined);

  useEffect(() => {
    setSlots(undefined);
  }, [item.eventId, item.startsAt]);

  const move = (index: number, direction: -1 | 1): void => {
    const next = index + direction;
    if (next < 0 || next >= shownSlots.length) return;
    const copy = [...shownSlots];
    const current = copy[index];
    const swap = copy[next];
    if (current === undefined || swap === undefined) return;
    copy[index] = swap;
    copy[next] = current;
    setSlots(copy);
  };

  const save = async (): Promise<void> => {
    setError(undefined);
    const saved = await saveLineup.mutateAsync({
      teamId,
      body: {
        eventId: item.eventId,
        occurrenceStartsAt: item.startsAt,
        slots: shownSlots,
      },
    });
    setSlots(saved.slots);
    setNotice(t('schedule.lineupSaved'));
  };

  const copyPrevious = async (): Promise<void> => {
    setError(undefined);
    const previous = await api.getLineup(teamId, {
      eventId: item.eventId,
      occurrenceStartsAt: item.startsAt,
      source: 'previous',
    });
    if (previous.slots.length === 0 || previous.occurrenceStartsAt === item.startsAt) {
      setNotice(t('schedule.noPreviousLineup'));
      return;
    }
    setSlots(previous.slots);
    setNotice(t('schedule.lineupCopied'));
  };

  const available = roster.filter((member) => !shownSlots.some((slot) => slot.userId === member.userId));

  return (
    <View className="mt-2">
      <Text className="mb-2 font-semibold text-ink">{t('schedule.lineup')}</Text>
      <ErrorText message={shown} />
      {notice !== undefined ? <Text className="mb-2 text-muted">{notice}</Text> : null}
      {shownSlots.length === 0 ? <Text className="mb-2 text-muted">{t('schedule.lineupEmpty')}</Text> : null}
      {shownSlots.map((slot, index) => (
        <View key={slot.userId} className="mb-3">
          <Text className="mb-1 text-ink">{nameOf(slot.userId)}</Text>
          {canManage ? (
            <Field
              label={t('schedule.position')}
              value={slot.position}
              onChangeText={(position) => {
                setSlots(shownSlots.map((row) => (row.userId === slot.userId ? { ...row, position } : row)));
              }}
            />
          ) : (
            <Text className="text-muted">{slot.position}</Text>
          )}
          {canManage ? (
            <View className="flex-row">
              <Button label={t('schedule.moveUp')} tone="secondary" onPress={() => move(index, -1)} />
              <Button label={t('schedule.moveDown')} tone="secondary" onPress={() => move(index, 1)} />
              <Button
                label={t('schedule.removeFromLineup')}
                tone="secondary"
                onPress={() => setSlots(shownSlots.filter((row) => row.userId !== slot.userId))}
              />
            </View>
          ) : null}
        </View>
      ))}
      {canManage && adding ? (
        <View className="mb-3">
          {available.map((member) => (
            <Pressable
              key={member.userId}
              className="mb-2"
              onPress={() => {
                setSlots([...shownSlots, { userId: member.userId, position: member.positions?.[0] ?? 'Player' }]);
                setAdding(false);
              }}
            >
              <Text className="text-link">{nameOf(member.userId)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {canManage ? (
        <View>
          <Button label={t('schedule.addToLineup')} tone="secondary" onPress={() => setAdding(true)} />
          <Button label={t('schedule.copyPrevious')} tone="secondary" onPress={() => void copyPrevious().catch(() => setError(t('errors.event.lineupCopyFailed')))} />
          <SubmitButton label={t('schedule.saveLineup')} onPress={save} />
        </View>
      ) : null}
    </View>
  );
};

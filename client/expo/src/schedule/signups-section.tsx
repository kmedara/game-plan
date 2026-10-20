/**
 * Volunteer sign-ups for one occurrence: snacks, scorekeeper, drivers.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MAX_SIGNUP_CAPACITY, MAX_SIGNUP_SLOTS, type ScheduleOccurrence, type SignupSlot } from '@gameplan/types';
import { errorMessageKey, queryError } from '@/src/errors';
import { claimSignupMutation, putSignupsMutation, signupsQuery } from '@/src/queries/schedule';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field } from '@/src/ui';

/** Errors with wording specific to sign-ups. */
const SIGNUP_ERRORS = {
  signup_full: 'errors.signups.full',
  signup_capacity_below_claims: 'errors.signups.capacityBelowClaims',
  condition_failed: 'errors.signups.changed',
} as const;

/** One slot row while staff edit the list. */
type SlotDraft = { slotId?: string; label: string; capacity: string };

export const SignupsSection = ({
  item,
  teamId,
  userId,
  canManage,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  userId: string | undefined;
  canManage: boolean;
}) => {
  const { t } = useTranslation();
  const { api, brand } = useApp();
  const queryClient = useQueryClient();
  const loaded = useQuery(signupsQuery(api, teamId, item.eventId, item.startsAt));
  const claim = useMutation(claimSignupMutation(api, queryClient));
  const save = useMutation(putSignupsMutation(api, queryClient));
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<SlotDraft[] | undefined>();
  const slots = loaded.data ?? [];
  const occurrence = { eventId: item.eventId, occurrenceStartsAt: item.startsAt };
  const report = (fallback: string) => (err: unknown) => setError(t(errorMessageKey(err, fallback, SIGNUP_ERRORS)));

  if (slots.length === 0 && !canManage) return null;

  const toggle = (slot: SignupSlot, forUserId?: string): void => {
    setError(undefined);
    void claim
      .mutateAsync({ teamId, body: { ...occurrence, slotId: slot.slotId, ...(forUserId !== undefined ? { forUserId } : {}) } })
      .catch(report('errors.common.saveFailed'));
  };

  const saveSlots = (): void => {
    if (editing === undefined) return;
    setError(undefined);
    const rows = editing
      .map((row) => ({ ...row, label: row.label.trim(), capacity: Number(row.capacity) }))
      .filter((row) => row.label.length > 0);
    if (rows.some((row) => !Number.isInteger(row.capacity) || row.capacity < 1 || row.capacity > MAX_SIGNUP_CAPACITY)) {
      setError(t('errors.signups.badCapacity', { max: MAX_SIGNUP_CAPACITY }));
      return;
    }
    void save
      .mutateAsync({
        teamId,
        body: {
          ...occurrence,
          slots: rows.map((row) => ({ ...(row.slotId !== undefined ? { slotId: row.slotId } : {}), label: row.label, capacity: row.capacity })),
        },
      })
      .then(() => setEditing(undefined))
      .catch(report('errors.common.saveFailed'));
  };

  return (
    <View className="mb-4 mt-2">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('signups.title')}</Text>
      <ErrorText message={error ?? (queryError(loaded.error) !== undefined ? t('errors.common.loadFailed') : undefined)} />
      {editing !== undefined ? (
        <>
          {editing.map((row, index) => (
            <View key={row.slotId ?? `new-${index}`} className="flex-row items-end">
              <View className="mr-2 flex-1">
                <Field
                  label={t('signups.label')}
                  value={row.label}
                  placeholder={t('signups.labelHint')}
                  onChangeText={(label) => setEditing(editing.map((at, i) => (i === index ? { ...at, label } : at)))}
                />
              </View>
              <View className="w-20">
                <Field
                  label={t('signups.capacity')}
                  value={row.capacity}
                  keyboardType="decimal-pad"
                  onChangeText={(capacity) => setEditing(editing.map((at, i) => (i === index ? { ...at, capacity } : at)))}
                />
              </View>
            </View>
          ))}
          {editing.length < MAX_SIGNUP_SLOTS ? (
            <Button
              label={t('signups.addSlot')}
              tone="secondary"
              onPress={() => setEditing([...editing, { label: '', capacity: '1' }])}
            />
          ) : null}
          <Text className="mb-2 text-sm text-muted">{t('signups.removeHint')}</Text>
          <Button label={t('common.save')} busy={save.isPending} onPress={saveSlots} />
          <Button label={t('common.cancel')} tone="secondary" onPress={() => setEditing(undefined)} />
        </>
      ) : (
        <>
          {slots.map((slot) => {
            const mine = slot.claims.some((claimant) => claimant.userId === userId);
            const full = slot.claims.length >= slot.capacity;
            return (
              <View key={slot.slotId} className="mb-2 rounded-xl bg-inset p-3">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 font-semibold text-ink">{slot.label}</Text>
                  <Text className="text-muted">{t('signups.filled', { taken: slot.claims.length, capacity: slot.capacity })}</Text>
                </View>
                {slot.claims.map((claimant) => (
                  <View key={claimant.userId} className="mt-1 flex-row items-center justify-between">
                    <Text className="text-ink">{claimant.displayName ?? t('common.unknownPerson')}</Text>
                    {canManage && claimant.userId !== userId ? (
                      <Pressable accessibilityRole="button" onPress={() => toggle(slot, claimant.userId)}>
                        <Text style={{ color: brand.secondary }}>{t('signups.remove')}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {userId !== undefined && (mine || !full) ? (
                  <Pressable accessibilityRole="button" className="mt-2" onPress={() => toggle(slot)}>
                    <Text className="font-semibold" style={{ color: brand.secondary }}>
                      {mine ? t('signups.leave') : t('signups.take')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          {canManage ? (
            <Button
              label={slots.length === 0 ? t('signups.addFirst') : t('signups.edit')}
              tone="secondary"
              onPress={() =>
                setEditing(
                  slots.length === 0
                    ? [{ label: '', capacity: '1' }]
                    : slots.map((slot) => ({ slotId: slot.slotId, label: slot.label, capacity: String(slot.capacity) })),
                )
              }
            />
          ) : null}
        </>
      )}
    </View>
  );
};

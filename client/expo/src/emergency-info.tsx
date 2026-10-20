/**
 * Emergency and medical info: the profile section (yourself and your
 * children) and the read-only card staff see on a member's page.
 *
 * Nothing here is written to device storage; the query keys are left out of
 * the persisted cache.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { EmergencyContact, MedicalInfo, MedicalPerson } from '@gameplan/types';
import { errorMessageKey, queryError } from './errors';
import { bodyFromDraft, draftFromInfo, MEDICAL_TEXT_FIELDS, type MedicalDraft } from './medical-form';
import { openLink } from './open-link';
import { queryKeys } from './queries/keys';
import { Sheet } from './sheet';
import { useApp } from './state';
import { Button, ErrorText, Field, SubmitButton } from './ui';

/** The filled-in parts of a record, read-only. */
const InfoSummary = ({ info, guardians }: { info: MedicalInfo; guardians?: { displayName: string; phoneNumber?: string }[] }) => {
  const { t } = useTranslation();
  const { brand } = useApp();
  const filled = MEDICAL_TEXT_FIELDS.filter((field) => (info[field] ?? '').length > 0);
  const contacts: (EmergencyContact | { name: string; phone?: string; relation?: string })[] = [
    ...(guardians ?? []).map((guardian) => ({
      name: guardian.displayName,
      ...(guardian.phoneNumber !== undefined ? { phone: guardian.phoneNumber } : {}),
      relation: t('emergency.guardian'),
    })),
    ...info.emergencyContacts,
  ];
  if (filled.length === 0 && contacts.length === 0) {
    return <Text className="text-muted">{t('emergency.empty')}</Text>;
  }
  return (
    <View>
      {filled.map((field) => (
        <Text key={field} className="mb-1 text-ink">
          <Text className="font-semibold">{t(`emergency.field.${field}`)}: </Text>
          {info[field]}
        </Text>
      ))}
      {contacts.map((contact, index) => (
        <Pressable
          key={`${contact.name}-${index}`}
          accessibilityRole="button"
          disabled={contact.phone === undefined}
          onPress={() => (contact.phone === undefined ? undefined : void openLink(`tel:${contact.phone}`))}
          className="mb-1"
        >
          <Text className="text-ink">
            {contact.name}
            {contact.relation !== undefined ? ` (${contact.relation})` : ''}
            {contact.phone !== undefined ? ' · ' : ''}
            {contact.phone !== undefined ? <Text style={{ color: brand.secondary }}>{contact.phone}</Text> : null}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};

/** Sheet to edit one person's record. */
const EditSheet = ({ person, onClose }: { person: MedicalPerson; onClose: () => void }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<MedicalDraft>(() => draftFromInfo(person.info));
  const save = useMutation({
    mutationFn: () => api.putMedical(person.userId, bodyFromDraft(draft)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.medical }),
  });
  const setContact = (index: number, patch: Partial<MedicalDraft['contacts'][number]>): void =>
    setDraft((current) => ({
      ...current,
      contacts: current.contacts.map((contact, at) => (at === index ? { ...contact, ...patch } : contact)),
    }));

  return (
    <Sheet visible title={t('emergency.editTitle', { name: person.displayName })} closeLabel={t('common.cancel')} onClose={onClose}>
      {MEDICAL_TEXT_FIELDS.map((field) => (
        <Field
          key={field}
          label={t(`emergency.field.${field}`)}
          value={draft[field]}
          multiline={field !== 'insurance'}
          onChangeText={(value) => setDraft((current) => ({ ...current, [field]: value }))}
        />
      ))}
      <Text className="mb-2 mt-2 text-lg font-semibold text-ink">{t('emergency.contacts')}</Text>
      {draft.contacts.map((contact, index) => (
        <View key={index} className="mb-2 rounded-xl border border-line p-2">
          <Field label={t('emergency.contactName')} value={contact.name} onChangeText={(name) => setContact(index, { name })} />
          <Field
            label={t('emergency.contactPhone')}
            value={contact.phone}
            keyboardType="phone-pad"
            onChangeText={(phone) => setContact(index, { phone })}
          />
          <Field
            label={t('emergency.contactRelation')}
            value={contact.relation}
            onChangeText={(relation) => setContact(index, { relation })}
          />
        </View>
      ))}
      <SubmitButton
        label={t('common.save')}
        onPress={async () => {
          await save.mutateAsync();
          onClose();
        }}
        message={(err) =>
          t(
            errorMessageKey(err, 'errors.common.saveFailed', {
              contact_incomplete: 'errors.emergency.contactIncomplete',
              invalid_body: 'errors.emergency.invalid',
            }),
          )
        }
      />
    </Sheet>
  );
};

/** Profile section: the caller's own record and each child's. */
export const EmergencyInfoSection = () => {
  const { t } = useTranslation();
  const { api } = useApp();
  const people = useQuery({ queryKey: queryKeys.medical, queryFn: () => api.listMedical() });
  const [editing, setEditing] = useState<MedicalPerson | undefined>();
  const loadError = queryError(people.error);
  if (people.data === undefined && loadError === undefined) return null;

  return (
    <View className="mb-2 mt-4">
      <Text className="mb-1 text-lg font-semibold text-ink">{t('emergency.title')}</Text>
      <Text className="mb-2 text-muted">{t('emergency.hint')}</Text>
      <ErrorText message={loadError === undefined ? undefined : t(errorMessageKey(loadError, 'errors.common.loadFailed'))} />
      {(people.data ?? []).map((person) => (
        <View key={person.userId} className="mb-3 rounded-xl bg-inset p-3">
          <Text className="mb-1 font-semibold text-ink">{person.displayName}</Text>
          <InfoSummary info={person.info} />
          {person.canEdit ? (
            <View className="mt-2">
              <Button label={t('emergency.edit')} tone="secondary" onPress={() => setEditing(person)} />
            </View>
          ) : (
            <Text className="mt-1 text-sm text-muted">{t('emergency.guardianKeeps')}</Text>
          )}
        </View>
      ))}
      {editing !== undefined ? <EditSheet person={editing} onClose={() => setEditing(undefined)} /> : null}
    </View>
  );
};

/**
 * A member's info for staff. Loaded only when opened, because each read is
 * logged on the team.
 */
export const MemberEmergencyInfo = ({ teamId, userId }: { teamId: string; userId: string }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [open, setOpen] = useState(false);
  const loaded = useQuery({
    queryKey: queryKeys.memberMedical(teamId, userId),
    queryFn: () => api.getMemberMedical(teamId, userId),
    enabled: open,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
  const loadError = queryError(loaded.error);

  return (
    <View className="mt-4 rounded-xl border border-line p-3">
      <Text className="mb-1 text-lg font-semibold text-ink">{t('emergency.title')}</Text>
      {!open ? (
        <>
          <Text className="mb-2 text-sm text-muted">{t('emergency.staffNote')}</Text>
          <Button label={t('emergency.show')} tone="secondary" onPress={() => setOpen(true)} />
        </>
      ) : loadError !== undefined ? (
        <ErrorText message={t(errorMessageKey(loadError, 'errors.common.loadFailed'))} />
      ) : loaded.data === undefined ? (
        <Text className="text-muted">{t('common.loading')}</Text>
      ) : (
        <InfoSummary info={loaded.data.info} guardians={loaded.data.guardians} />
      )}
    </View>
  );
};

/**
 * Team waivers for staff: write or copy one, see who is missing, record paper
 * forms, edit, and archive.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamRole, Waiver, WaiverMember } from '@gameplan/types';
import { DayField } from '@/src/day-field';
import { errorMessageKey, queryError } from '@/src/errors';
import { teamEntitlements } from '@/src/plan';
import { teamQuery } from '@/src/queries/teams';
import {
  createWaiverFromTemplateMutation,
  createWaiverMutation,
  paperWaiverMutation,
  teamWaiverTemplatesQuery,
  updateWaiverMutation,
  waiverQuery,
  waiversQuery,
} from '@/src/queries/waivers';
import { RefreshableScroll } from '@/src/pull-refresh';
import { Sheet } from '@/src/sheet';
import { useApp, useBrandTeam } from '@/src/state';
import { Button, ErrorText, Field, SubmitButton } from '@/src/ui';
import { UpgradeCard } from '@/src/upgrade-card';
import { WAIVER_ERRORS } from '@/src/waiver-rules';
import { AudiencePicker, CheckRow, SignatureSheet, WaiverStatusLabel } from '@/src/waivers';

/** Which waiver the edit sheet is for: `new`, or an existing one. */
type Editing = 'new' | Waiver | undefined;

export default function TeamWaiversScreen() {
  const { t } = useTranslation();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const id = teamId ?? '';
  const enabled = id.length > 0;
  useBrandTeam(enabled ? id : undefined);
  const { api } = useApp();
  const team = useQuery({ ...teamQuery(api, id), enabled });
  const waivers = useQuery({ ...waiversQuery(api, id), enabled });
  const [editing, setEditing] = useState<Editing>();
  const [openId, setOpenId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const allowed = teamEntitlements(team.data).waivers;

  useEffect(() => {
    const failed = queryError(waivers.error);
    if (failed !== undefined) setError(t(errorMessageKey(failed, 'errors.common.loadFailed', WAIVER_ERRORS)));
  }, [waivers.error, t]);

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('waivers.title')}</Text>
      <ErrorText message={error} />
      {team.data !== undefined && !allowed ? <UpgradeCard teamId={id} message={t('waivers.upgrade')} /> : null}
      {allowed ? <Button label={t('waivers.new')} onPress={() => setEditing('new')} /> : null}
      {waivers.data?.length === 0 ? <Text className="mb-4 text-muted">{t('waivers.none')}</Text> : null}
      {waivers.data?.map((waiver) => (
        <WaiverRow
          key={waiver.waiverId}
          waiver={waiver}
          open={openId === waiver.waiverId}
          canEdit={allowed}
          onToggle={() => setOpenId((current) => (current === waiver.waiverId ? undefined : waiver.waiverId))}
          onEdit={() => setEditing(waiver)}
        />
      ))}
      <WaiverSheet teamId={id} editing={editing} onClose={() => setEditing(undefined)} />
    </RefreshableScroll>
  );
}

/** One waiver; tapping it shows each member's standing. */
const WaiverRow = ({
  waiver,
  open,
  canEdit,
  onToggle,
  onEdit,
}: {
  waiver: Waiver;
  open: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) => {
  const { t } = useTranslation();
  const { api, brand } = useApp();
  const queryClient = useQueryClient();
  const update = useMutation(updateWaiverMutation(api, queryClient, waiver.teamId, waiver.waiverId));
  const [error, setError] = useState<string | undefined>();

  const setArchived = (archived: boolean): void => {
    setError(undefined);
    update.mutate(
      { archived },
      { onError: (err) => setError(t(errorMessageKey(err, 'errors.common.saveFailed', WAIVER_ERRORS))) },
    );
  };

  return (
    <View className="mb-2 rounded-xl bg-inset p-3" style={{ opacity: waiver.archived ? 0.7 : 1 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle}>
        <Text className="font-semibold text-ink" numberOfLines={1}>
          {waiver.title}
        </Text>
        <Text className="text-muted">
          {[
            waiver.archived ? t('waivers.archived') : undefined,
            waiver.dueDate !== undefined ? t('payments.dueOn', { date: waiver.dueDate }) : undefined,
            t('waivers.signedCount', { signed: waiver.totals.signed, members: waiver.totals.members }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Pressable>
      {open ? (
        <>
          <ErrorText message={error} />
          <View className="mt-2 flex-row">
            {canEdit ? (
              <Pressable accessibilityRole="button" className="mr-4 py-1" onPress={onEdit}>
                <Text style={{ color: brand.secondary }}>{t('waivers.edit')}</Text>
              </Pressable>
            ) : null}
            {canEdit ? (
              <Pressable accessibilityRole="button" className="mr-4 py-1" onPress={() => setArchived(!waiver.archived)}>
                <Text style={{ color: brand.secondary }}>{waiver.archived ? t('waivers.unarchive') : t('waivers.archive')}</Text>
              </Pressable>
            ) : null}
          </View>
          <WaiverMembers teamId={waiver.teamId} waiverId={waiver.waiverId} />
        </>
      ) : null}
    </View>
  );
};

/** The missing list, with paper forms for anyone who cannot sign in the app. */
const WaiverMembers = ({ teamId, waiverId }: { teamId: string; waiverId: string }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const detail = useQuery(waiverQuery(api, teamId, waiverId));
  const [viewing, setViewing] = useState<string | undefined>();

  if (detail.data === undefined) return <Text className="mt-2 text-muted">{t('common.loading')}</Text>;
  return (
    <View className="mt-2 border-t border-line pt-2">
      {detail.data.members.length === 0 ? <Text className="text-muted">{t('waivers.nobodyAsked')}</Text> : null}
      {detail.data.members.map((member) => (
        <MemberLine
          key={member.memberId}
          teamId={teamId}
          waiverId={waiverId}
          member={member}
          onView={() => setViewing(member.memberId)}
        />
      ))}
      <SignatureSheet
        target={viewing === undefined ? undefined : { teamId, waiverId, memberId: viewing }}
        onClose={() => setViewing(undefined)}
      />
    </View>
  );
};

/** One member: status, how they signed, and what staff can do. */
const MemberLine = ({
  teamId,
  waiverId,
  member,
  onView,
}: {
  teamId: string;
  waiverId: string;
  member: WaiverMember;
  onView: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const { api, brand } = useApp();
  const queryClient = useQueryClient();
  const paper = useMutation(paperWaiverMutation(api, queryClient, teamId, waiverId));
  const [recording, setRecording] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const fail = (err: unknown): void => setError(t(errorMessageKey(err, 'errors.common.saveFailed', WAIVER_ERRORS)));

  const link = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" className="mr-4 py-1" onPress={onPress}>
      <Text style={{ color: brand.secondary }}>{label}</Text>
    </Pressable>
  );

  return (
    <View className="mb-2">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-ink">{member.memberName ?? t('common.unknownPerson')}</Text>
        <WaiverStatusLabel status={member.status} />
      </View>
      {member.signedAt !== undefined ? (
        <Text className="text-sm text-muted">
          {t(member.method === 'paper' ? 'waivers.signedOnPaper' : 'waivers.signedBy', {
            name: member.signerName ?? '',
            date: new Date(member.signedAt).toLocaleDateString(i18n.language),
          })}
        </Text>
      ) : null}
      {member.status !== 'signed' && !member.canSignInApp ? (
        <Text className="text-sm text-muted">{t('waivers.noSignerInApp')}</Text>
      ) : null}
      <ErrorText message={error} />
      <View className="flex-row">
        {member.signedAt !== undefined ? link(t('waivers.view'), onView) : null}
        {member.status !== 'signed' && !recording ? link(t('waivers.recordPaper'), () => setRecording(true)) : null}
        {member.status === 'signed' && member.method === 'paper'
          ? link(t('waivers.undoPaper'), () => {
              setError(undefined);
              paper.mutate({ memberId: member.memberId }, { onError: fail });
            })
          : null}
      </View>
      {recording ? (
        <View className="mt-1">
          <Field label={t('waivers.paperSignerName')} value={signerName} onChangeText={setSignerName} />
          <SubmitButton
            label={t('waivers.recordPaper')}
            disabled={signerName.trim().length < 2}
            loadedText=""
            onPress={async () => {
              await paper.mutateAsync({ memberId: member.memberId, signerName: signerName.trim() });
              setRecording(false);
              setSignerName('');
              return true;
            }}
            message={(err) => t(errorMessageKey(err, 'errors.common.saveFailed', WAIVER_ERRORS))}
          />
        </View>
      ) : null}
    </View>
  );
};

/** Write a new waiver, copy an organization template, or edit an existing waiver. */
const WaiverSheet = ({ teamId, editing, onClose }: { teamId: string; editing: Editing; onClose: () => void }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const existing = editing !== undefined && editing !== 'new' ? editing : undefined;
  const create = useMutation(createWaiverMutation(api, queryClient, teamId));
  const copy = useMutation(createWaiverFromTemplateMutation(api, queryClient, teamId));
  const update = useMutation(updateWaiverMutation(api, queryClient, teamId, existing?.waiverId ?? ''));
  const templates = useQuery({ ...teamWaiverTemplatesQuery(api, teamId), enabled: editing === 'new' });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<TeamRole[]>(['player']);
  const [hasDue, setHasDue] = useState(false);
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (editing === undefined) return;
    setTitle(existing?.title ?? '');
    setBody(existing?.body ?? '');
    setAudience(existing?.audience ?? ['player']);
    setHasDue(existing?.dueDate !== undefined);
    setDueDate(existing?.dueDate ?? new Date().toISOString().slice(0, 10));
  }, [editing]);

  const textChanged = existing !== undefined && (title.trim() !== existing.title || body.trim() !== existing.body);
  const errorText = (err: unknown): string =>
    t(
      errorMessageKey(err, 'errors.common.saveFailed', {
        ...WAIVER_ERRORS,
        title_required: 'errors.waivers.titleRequired',
        body_required: 'errors.waivers.bodyRequired',
      }),
    );

  const save = async (): Promise<boolean> => {
    if (title.trim().length === 0) throw new Error('title_required');
    if (body.trim().length === 0) throw new Error('body_required');
    if (existing === undefined) {
      await create.mutateAsync({
        title: title.trim(),
        body: body.trim(),
        audience: [audience[0] ?? 'player', ...audience.slice(1)],
        ...(hasDue ? { dueDate } : {}),
      });
    } else {
      await update.mutateAsync({
        ...(title.trim() !== existing.title ? { title: title.trim() } : {}),
        ...(body.trim() !== existing.body ? { body: body.trim() } : {}),
        audience: [audience[0] ?? 'player', ...audience.slice(1)],
        dueDate: hasDue ? dueDate : null,
      });
    }
    onClose();
    return true;
  };

  const offered = templates.data?.templates ?? [];

  return (
    <Sheet
      visible={editing !== undefined}
      title={existing === undefined ? t('waivers.new') : t('waivers.edit')}
      closeLabel={t('common.cancel')}
      onClose={onClose}
    >
      {existing === undefined && offered.length > 0 ? (
        <View className="mb-4 rounded-xl border border-line bg-raised p-3">
          <Text className="mb-2 font-semibold text-ink">{t('waivers.fromTemplate')}</Text>
          {offered.map((template) => (
            <SubmitButton
              key={template.templateId}
              label={template.title}
              tone="secondary"
              loadedText=""
              onPress={async () => {
                await copy.mutateAsync({ templateId: template.templateId, ...(hasDue ? { dueDate } : {}) });
                onClose();
                return true;
              }}
              message={errorText}
            />
          ))}
          <Text className="text-sm text-muted">{t('waivers.fromTemplateHint')}</Text>
        </View>
      ) : null}
      <Field label={t('waivers.titleField')} value={title} onChangeText={setTitle} placeholder={t('waivers.titleHint')} />
      <Field label={t('waivers.bodyField')} value={body} onChangeText={setBody} multiline />
      {textChanged ? <Text className="mb-3 text-danger">{t('waivers.resignWarning')}</Text> : null}
      <AudiencePicker value={audience} onChange={setAudience} />
      <CheckRow label={t('waivers.hasDueDate')} checked={hasDue} onToggle={() => setHasDue((current) => !current)} />
      {hasDue ? (
        <View className="mb-3">
          <DayField value={dueDate} onChange={setDueDate} />
          <Text className="mt-1 text-sm text-muted">{t('waivers.reminderHint')}</Text>
        </View>
      ) : null}
      <Text className="mb-3 text-sm text-muted">{t('waivers.legalStaffNote')}</Text>
      <SubmitButton
        label={existing === undefined ? t('waivers.send') : t('common.save')}
        onPress={save}
        loadedText=""
        message={errorText}
      />
    </Sheet>
  );
};

/**
 * Shared pieces for the waiver screens: status text, the role picker, the
 * signing sheet, and the signed copy with its PDF.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Check from 'lucide-react-native/icons/check';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MyWaiver, TeamRole, WaiverMemberStatus } from '@gameplan/types';
import { TEAM_ROLES } from '@gameplan/types';
import { errorMessageKey } from './errors';
import { signWaiverMutation, waiverSignatureQuery } from './queries/waivers';
import { Sheet } from './sheet';
import { useApp } from './state';
import { colors } from './theme';
import { Chip, Field, SubmitButton } from './ui';
import { openWaiverPdf } from './waiver-pdf';
import { WAIVER_ERRORS, signatureReady, toggleAudienceRole } from './waiver-rules';

/** Status text, red while a signature is still needed. */
export const WaiverStatusLabel = ({ status }: { status: WaiverMemberStatus }) => {
  const { t } = useTranslation();
  return (
    <Text className="text-sm font-semibold" style={{ color: status === 'signed' ? colors.muted : colors.danger }}>
      {t(`waivers.status.${status}`)}
    </Text>
  );
};

/** A tappable box with a label. */
export const CheckRow = ({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) => {
  const { brand } = useApp();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      className="mb-3 min-h-9 flex-row items-center"
      onPress={onToggle}
    >
      <View
        className="mr-3 h-6 w-6 items-center justify-center rounded-md border-2"
        style={{ borderColor: checked ? brand.primary : colors.line, backgroundColor: checked ? brand.primary : colors.paper }}
      >
        {checked ? <Check size={16} color={brand.onPrimary} strokeWidth={3} /> : null}
      </View>
      <Text className="flex-1 text-base text-ink">{label}</Text>
    </Pressable>
  );
};

/** Which roles must sign. At least one stays picked. */
export const AudiencePicker = ({ value, onChange }: { value: TeamRole[]; onChange: (next: TeamRole[]) => void }) => {
  const { t } = useTranslation();
  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-muted">{t('waivers.audience')}</Text>
      <View className="flex-row flex-wrap">
        {TEAM_ROLES.map((role) => (
          <Chip
            key={role}
            label={t(`role.${role}`)}
            selected={value.includes(role)}
            onPress={() => onChange(toggleAudienceRole(value, role))}
          />
        ))}
      </View>
    </View>
  );
};

/**
 * Reads a waiver in full, then signs it with a typed name and a ticked box.
 *
 * Sends the version that was shown, so an edit made meanwhile is refused rather than signed unseen.
 */
export const SignWaiverSheet = ({ waiver, onClose }: { waiver: MyWaiver | undefined; onClose: () => void }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const sign = useMutation(signWaiverMutation(api, queryClient));
  const [signerName, setSignerName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const forChild = waiver !== undefined && waiver.memberId !== api.user?.userId;

  useEffect(() => {
    setSignerName(api.user?.displayName ?? '');
    setAgreed(false);
  }, [waiver?.waiverId, waiver?.memberId, api.user?.displayName]);

  const submit = async (): Promise<boolean> => {
    if (waiver === undefined) return false;
    await sign.mutateAsync({
      teamId: waiver.teamId,
      waiverId: waiver.waiverId,
      memberId: waiver.memberId,
      body: { version: waiver.version, signerName: signerName.trim(), agree: true },
    });
    onClose();
    return true;
  };

  return (
    <Sheet visible={waiver !== undefined} title={waiver?.title ?? ''} closeLabel={t('common.cancel')} onClose={onClose}>
      {waiver !== undefined ? (
        <>
          <Text className="mb-1 text-muted">
            {[waiver.teamName, forChild ? t('waivers.forMember', { name: waiver.memberName ?? '' }) : undefined]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View className="mb-4 rounded-xl border border-line bg-inset p-3">
            <Text selectable className="text-base text-ink">
              {waiver.body}
            </Text>
          </View>
          <Field label={t('waivers.signerName')} value={signerName} onChangeText={setSignerName} />
          <CheckRow
            label={
              forChild
                ? t('waivers.agreeForChild', { name: waiver.memberName ?? '' })
                : t('waivers.agree')
            }
            checked={agreed}
            onToggle={() => setAgreed((current) => !current)}
          />
          <Text className="mb-3 text-sm text-muted">{t('waivers.legalNote')}</Text>
          <SubmitButton
            label={t('waivers.sign')}
            onPress={submit}
            disabled={!signatureReady(signerName, agreed)}
            loadedText=""
            message={(err) => t(errorMessageKey(err, 'errors.waivers.signFailed', WAIVER_ERRORS))}
          />
        </>
      ) : null}
    </Sheet>
  );
};

/** The signed record: who signed, when, and the exact text, for the member, a guardian, or staff. */
export const SignatureSheet = ({
  target,
  onClose,
}: {
  target: { teamId: string; waiverId: string; memberId: string } | undefined;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const { api } = useApp();
  const record = useQuery({
    ...waiverSignatureQuery(api, target?.teamId ?? '', target?.waiverId ?? '', target?.memberId ?? ''),
    enabled: target !== undefined,
  });
  const signature = record.data;
  return (
    <Sheet visible={target !== undefined} title={t('waivers.signedCopy')} closeLabel={t('common.close')} onClose={onClose}>
      {signature === undefined ? (
        <Text className="text-muted">{record.isError ? t('errors.common.loadFailed') : t('common.loading')}</Text>
      ) : (
        <>
          <Text className="mb-1 text-lg font-semibold text-ink">{signature.title}</Text>
          <Text className="mb-1 text-ink">
            {t(signature.method === 'paper' ? 'waivers.signedOnPaper' : 'waivers.signedBy', {
              name: signature.signerName,
              date: new Date(signature.signedAt).toLocaleString(i18n.language),
            })}
          </Text>
          <Text className="mb-3 text-sm text-muted">
            {t('waivers.versionAndHash', { version: signature.version, hash: signature.textHash.slice(0, 12) })}
          </Text>
          <SubmitButton
            label={t('waivers.downloadPdf')}
            tone="secondary"
            loadedText=""
            onPress={() => openWaiverPdf(api, { teamId: signature.teamId, waiverId: signature.waiverId, memberId: signature.memberId })}
            message={(err) => t(errorMessageKey(err, 'errors.waivers.pdfFailed', WAIVER_ERRORS))}
          />
          <View className="rounded-xl border border-line bg-inset p-3">
            <Text selectable className="text-base text-ink">
              {signature.body}
            </Text>
          </View>
        </>
      )}
    </Sheet>
  );
};

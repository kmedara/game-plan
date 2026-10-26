/**
 * One organization: plan and billing, teams, admins, waiver templates, and announcements.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { effectivePlanTier } from '@gameplan/rules';
import { ORG_INCLUDED_TEAMS, type BillingInterval, type OrgDetail } from '@gameplan/types';
import { errorMessageKey, queryError } from '@/src/errors';
import { OrgWaiverTemplates } from '@/src/org-waiver-templates';
import { canBuyPlansHere, planNameKey } from '@/src/plan';
import { RefreshableScroll } from '@/src/pull-refresh';
import { orgQuery, refreshOrg } from '@/src/queries/orgs';
import { directoryQuery } from '@/src/queries/teams';
import { useApp } from '@/src/state';
import { BILLING_RETURN_LINK, openStripePage } from '@/src/stripe-page';
import { Chip, EqualChipRow, ErrorText, Field, SubmitButton } from '@/src/ui';

/** Error sentences specific to organizations. */
const ORG_ERRORS = {
  user_not_found: 'errors.orgs.userNotFound',
  org_admin_must_be_adult: 'errors.orgs.adminMustBeAdult',
  owner_cannot_leave: 'errors.orgs.ownerCannotLeave',
  team_in_another_organization: 'errors.orgs.otherOrg',
  already_in_organization: 'errors.orgs.alreadyIn',
  plan_required: 'errors.orgs.planRequired',
  too_many_templates: 'errors.waivers.tooManyTemplates',
  template_not_found: 'errors.waivers.templateNotFound',
  already_subscribed: 'errors.billing.alreadySubscribed',
  billing_not_configured: 'errors.billing.notConfigured',
} as const;

export default function OrgScreen() {
  const { t } = useTranslation();
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  const id = orgId ?? '';
  const { api } = useApp();
  const queryClient = useQueryClient();
  const org = useQuery({ ...orgQuery(api, id), enabled: id.length > 0 });
  const loadError = queryError(org.error);
  const data = org.data;
  const refresh = (): Promise<unknown> => refreshOrg(queryClient, id);
  const message = (err: unknown): string => t(errorMessageKey(err, 'errors.common.requestFailed', ORG_ERRORS));

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <ErrorText message={loadError === undefined ? undefined : message(loadError)} />
      {data === undefined ? null : (
        <>
          <Text className="mb-1 text-2xl font-bold text-ink">{data.name}</Text>
          <PlanSection org={data} message={message} />
          <TeamsSection org={data} refresh={refresh} message={message} />
          <AdminsSection org={data} refresh={refresh} message={message} />
          <OrgWaiverTemplates org={data} message={message} />
          <AnnounceSection org={data} message={message} />
        </>
      )}
    </RefreshableScroll>
  );
}

type SectionProps = { org: OrgDetail; message: (err: unknown) => string };

/** The plan, extra teams, and checkout or the billing portal for the owner. */
const PlanSection = ({ org, message }: SectionProps) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [interval, setBillingInterval] = useState<BillingInterval>('year');
  const paid = effectivePlanTier(org.plan) !== 'free';

  const open = async (start: () => Promise<{ url: string }>): Promise<void> => {
    const { url } = await start();
    await openStripePage(url, BILLING_RETURN_LINK);
    await refreshOrg(queryClient, org.orgId);
  };

  return (
    <View className="mb-4 mt-2 rounded-xl bg-inset p-3">
      <Text className="font-semibold text-ink">{t(planNameKey(org.plan.tier))}</Text>
      <Text className="text-muted">
        {t('orgs.teamsIncluded', { count: org.teamCount, included: ORG_INCLUDED_TEAMS })}
        {org.extraTeams > 0 ? ` · ${t('orgs.extraTeams', { count: org.extraTeams })}` : ''}
      </Text>
      {!org.isOwner ? null : !canBuyPlansHere() ? (
        <Text className="mt-2 text-muted">{t('plans.manageOnWeb')}</Text>
      ) : paid ? (
        <View className="mt-2">
          <SubmitButton label={t('plans.manageBilling')} loadedText="" onPress={() => open(() => api.createOrgPortal(org.orgId))} message={message} />
        </View>
      ) : (
        <View className="mt-2">
          <Text className="mb-2 text-ink">{t('orgs.subscribeHint')}</Text>
          <EqualChipRow className="mb-2">
            {(['month', 'year'] as const).map((value) => (
              <Chip
                key={value}
                equal
                label={`${t(value === 'month' ? 'plans.monthly' : 'plans.yearly')} · ${t(`plans.price.organization.${value}`)}`}
                selected={interval === value}
                onPress={() => setBillingInterval(value)}
              />
            ))}
          </EqualChipRow>
          <SubmitButton
            label={t('orgs.subscribe')}
            loadedText=""
            onPress={() => open(() => api.createOrgCheckout(org.orgId, interval))}
            message={message}
          />
        </View>
      )}
    </View>
  );
};

/** Teams, invitations, and finding a team to invite. */
const TeamsSection = ({ org, refresh, message }: SectionProps & { refresh: () => Promise<unknown> }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { api, brand } = useApp();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | undefined>();
  const directory = useInfiniteQuery({ ...directoryQuery(api, debounced), enabled: debounced.trim().length > 0 });
  const inOrg = new Set(org.teams.map((team) => team.teamId));
  const hits = (directory.data?.pages.flatMap((page) => page.teams) ?? []).filter((hit) => !inOrg.has(hit.teamId));
  const invite = useMutation({ mutationFn: (teamId: string) => api.inviteOrgTeam(org.orgId, teamId), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (teamId: string) => api.removeOrgTeam(org.orgId, teamId), onSuccess: refresh });

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(handle);
  }, [query]);

  const run = (task: Promise<unknown>): void => {
    setError(undefined);
    void task.catch((err: unknown) => setError(message(err)));
  };

  return (
    <View className="mb-4">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('orgs.teams')}</Text>
      <ErrorText message={error} />
      {org.teams.length === 0 ? <Text className="mb-2 text-muted">{t('orgs.noTeams')}</Text> : null}
      {org.teams.map((team) => (
        <View key={team.teamId} className="mb-2 flex-row items-center rounded-xl bg-inset p-3">
          <Pressable
            className="flex-1"
            disabled={team.pending}
            onPress={() => router.push({ pathname: '/teams/[teamId]', params: { teamId: team.teamId } })}
          >
            <Text className="font-semibold text-ink">{team.name}</Text>
            <Text className="text-muted">
              {team.pending ? t('orgs.invited') : t('orgs.memberCount', { count: team.memberCount })}
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => run(remove.mutateAsync(team.teamId))}>
            <Text style={{ color: brand.secondary }}>{team.pending ? t('orgs.withdraw') : t('orgs.removeTeam')}</Text>
          </Pressable>
        </View>
      ))}
      <Field label={t('orgs.inviteTeam')} value={query} onChangeText={setQuery} placeholder={t('orgs.inviteHint')} />
      {hits.map((hit) => (
        <Pressable
          key={hit.teamId}
          accessibilityRole="button"
          className="mb-1 rounded-lg border border-line px-3 py-2"
          onPress={() => {
            setQuery('');
            run(invite.mutateAsync(hit.teamId));
          }}
        >
          <Text className="text-ink">{t('orgs.inviteThis', { name: hit.name })}</Text>
        </Pressable>
      ))}
      <Text className="text-sm text-muted">{t('orgs.inviteNote')}</Text>
    </View>
  );
};

/** Admins; the owner adds and removes them. */
const AdminsSection = ({ org, refresh, message }: SectionProps & { refresh: () => Promise<unknown> }) => {
  const { t } = useTranslation();
  const { api, brand } = useApp();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const remove = useMutation({ mutationFn: (adminId: string) => api.removeOrgAdmin(org.orgId, adminId), onSuccess: refresh });

  return (
    <View className="mb-4">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('orgs.admins')}</Text>
      <ErrorText message={error} />
      {org.admins.map((admin) => (
        <View key={admin.userId} className="mb-1 flex-row items-center justify-between">
          <Text className="text-ink">
            {admin.displayName}
            {admin.userId === org.ownerId ? ` · ${t('orgs.owner')}` : ''}
          </Text>
          {org.isOwner && admin.userId !== org.ownerId ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setError(undefined);
                void remove.mutateAsync(admin.userId).catch((err: unknown) => setError(message(err)));
              }}
            >
              <Text style={{ color: brand.secondary }}>{t('orgs.removeAdmin')}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {org.isOwner ? (
        <View className="mt-2">
          <Field label={t('orgs.adminEmail')} value={email} onChangeText={setEmail} keyboardType="email-address" />
          <SubmitButton
            label={t('orgs.addAdmin')}
            loadedText=""
            disabled={email.trim().length === 0}
            onPress={async () => {
              await api.addOrgAdmin(org.orgId, email.trim());
              setEmail('');
              await refresh();
            }}
            message={message}
          />
        </View>
      ) : null}
    </View>
  );
};

/** One message to every team's main chat. Needs the organization plan. */
const AnnounceSection = ({ org, message }: SectionProps) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [body, setBody] = useState('');
  const [sent, setSent] = useState<number | undefined>();
  const paid = effectivePlanTier(org.plan) === 'organization';

  return (
    <View className="mb-8">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('orgs.announce')}</Text>
      {!paid ? (
        <Text className="text-muted">{t('orgs.announceNeedsPlan')}</Text>
      ) : (
        <>
          <Field label={t('orgs.announceMessage')} value={body} onChangeText={setBody} multiline />
          {sent !== undefined ? <Text className="mb-2 text-muted">{t('orgs.announceSent', { count: sent })}</Text> : null}
          <SubmitButton
            label={t('orgs.announceSend')}
            loadedText=""
            disabled={body.trim().length === 0}
            onPress={async () => {
              const result = await api.announceToOrg(org.orgId, body.trim());
              setSent(result.sent);
              setBody('');
            }}
            message={message}
          />
        </>
      )}
    </View>
  );
};

/**
 * Organizations the signed-in person administers, and creating one.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessageKey, queryError } from '@/src/errors';
import { planNameKey } from '@/src/plan';
import { RefreshableScroll } from '@/src/pull-refresh';
import { queryKeys } from '@/src/queries/keys';
import { orgsQuery } from '@/src/queries/orgs';
import { useApp } from '@/src/state';
import { ErrorText, Field, SubmitButton } from '@/src/ui';

export default function OrgsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const orgs = useQuery(orgsQuery(api));
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: (value: string) => api.createOrg(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.orgs }),
  });
  const adult = api.user?.accountKind === 'adult';
  const loadError = queryError(orgs.error);

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <Text className="mb-1 text-lg font-semibold text-ink">{t('orgs.title')}</Text>
      <Text className="mb-3 text-muted">{t('orgs.hint')}</Text>
      <ErrorText message={loadError === undefined ? undefined : t(errorMessageKey(loadError, 'errors.common.loadFailed'))} />
      {orgs.data?.length === 0 ? <Text className="mb-3 text-muted">{t('orgs.none')}</Text> : null}
      {orgs.data?.map((org) => (
        <Pressable
          key={org.orgId}
          accessibilityRole="button"
          className="mb-2 rounded-xl bg-inset p-3"
          onPress={() => router.push({ pathname: '/orgs/[orgId]', params: { orgId: org.orgId } })}
        >
          <Text className="font-semibold text-ink">{org.name}</Text>
          <Text className="text-muted">
            {t('orgs.teamCount', { count: org.teamCount })} · {t(planNameKey(org.plan.tier))}
          </Text>
        </Pressable>
      ))}
      {adult ? (
        <View className="mb-8 mt-4">
          <Text className="mb-1 text-lg font-semibold text-ink">{t('orgs.create')}</Text>
          <Field label={t('orgs.name')} value={name} onChangeText={setName} placeholder={t('orgs.nameHint')} />
          <SubmitButton
            label={t('orgs.create')}
            loadedText=""
            disabled={name.trim().length === 0}
            onPress={async () => {
              const org = await create.mutateAsync(name.trim());
              setName('');
              router.push({ pathname: '/orgs/[orgId]', params: { orgId: org.orgId } });
            }}
            message={(err) => t(errorMessageKey(err, 'errors.common.saveFailed'))}
          />
        </View>
      ) : null}
    </RefreshableScroll>
  );
}

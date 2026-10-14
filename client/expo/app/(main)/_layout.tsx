/**
 * Signed-in shell: header, team switcher, and bottom navigation.
 */

import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/src/state';

const titles: Record<string, string> = {
  '/schedule': 'title.schedule',
  '/chats': 'title.chats',
  '/teams': 'title.teams',
  '/profile': 'title.profile',
  '/invite': 'title.invite',
};

export default function MainLayout() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { api, teams, refreshTeams, selectTeam, brand, live } = useApp();
  const [ready, setReady] = useState(api.isAuthenticated());

  useEffect(() => {
    void api.refreshSession().then((ok) => {
      setReady(true);
      if (ok) {
        live.connect();
        void refreshTeams();
      }
    });
  }, [api, live]);

  if (!ready) return <View className="flex-1 bg-white" />;
  if (!api.isAuthenticated()) return <Redirect href="/login" />;
  if (api.user?.needsProfileCompletion && !pathname.startsWith('/complete-profile')) {
    return <Redirect href="/complete-profile" />;
  }

  const titleKey =
    Object.entries(titles).find(([path]) => pathname === path || pathname.startsWith(`${path}/`))?.[1] ??
    'title.teams';

  const tabs = [
    ...(api.hasTeams
      ? [
          { href: '/schedule' as const, label: t('nav.schedule') },
          { href: '/chats' as const, label: t('nav.chats') },
        ]
      : []),
    { href: '/teams' as const, label: t('nav.teams') },
    { href: '/profile' as const, label: t('nav.profile') },
  ];

  return (
    <View className="flex-1 bg-slate-50">
      <View className="flex-row items-center justify-between px-4 pb-3 pt-12" style={{ backgroundColor: brand.primary }}>
        <Text className="text-lg font-semibold" style={{ color: brand.onPrimary }}>
          {t(titleKey)}
        </Text>
        <View className="flex-row flex-wrap justify-end">
          {teams.map((team) => (
            <Pressable key={team.teamId} className="ml-2" onPress={() => selectTeam(team.teamId)}>
              <Text style={{ color: brand.onPrimary, fontWeight: team.teamId === api.selectedTeamId ? '700' : '400' }}>
                {team.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View className="flex-1">
        <Slot />
      </View>
      <View className="flex-row border-t border-slate-200 bg-white pb-6 pt-2">
        {tabs.map((tab) => (
          <Pressable key={tab.href} className="flex-1 items-center" onPress={() => router.push(tab.href)}>
            <Text className={pathname.startsWith(tab.href) ? 'font-bold text-teal-800' : 'text-slate-600'}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

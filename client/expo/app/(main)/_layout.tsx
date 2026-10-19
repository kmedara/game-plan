/**
 * Signed-in shell: header, team switcher, and bottom navigation.
 */

import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import User from 'lucide-react-native/icons/user';
import Users from 'lucide-react-native/icons/users';
import { useIsRestoring, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canCreateTeam } from '@gameplan/rules';
import { useDownloadUrl } from '@/src/media';
import { adoptCacheOwner } from '@/src/query-client';
import { useLiveQuerySync } from '@/src/use-live-query-sync';
import { PullRefreshProvider } from '@/src/pull-refresh';
import { useApp } from '@/src/state';
import { useTeamsWithPermission } from '@/src/team-access';
import { colors } from '@/src/theme';

const tabIcons = {
  '/schedule': Calendar,
  '/chats': MessageCircle,
  '/teams': Users,
  '/profile': User,
} as const;

const titles: Record<string, string> = {
  '/schedule': 'title.schedule',
  '/chats': 'title.chats',
  '/teams': 'title.teams',
  '/profile': 'title.profile',
  '/invite': 'title.invite',
};

/** One level up. A member or the payments page returns to that team; dues return to the profile. */
const parentPath = (pathname: string): string => {
  const teamPage = /^\/teams\/([^/]+)\/(members\/[^/]+|payments)$/.exec(pathname);
  if (teamPage !== null) return `/teams/${teamPage[1]}`;
  if (pathname === '/dues') return '/profile';
  return Object.keys(titles).find((path) => pathname.startsWith(`${path}/`)) ?? '/teams';
};

export default function MainLayout() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { api, brand, brandTeam, live, teams } = useApp();
  const queryClient = useQueryClient();
  const restoring = useIsRestoring();
  useLiveQuerySync();
  const [ready, setReady] = useState(api.isAuthenticated());
  const logoUrl = useDownloadUrl(brandTeam?.theme?.logoKey, { teamId: brandTeam?.teamId });
  const onChats = pathname === '/chats';
  const channelTeams = useTeamsWithPermission('create_team_channels', onChats);
  const section = Object.keys(titles).find((path) => pathname === path || pathname.startsWith(`${path}/`));
  const headerName = brandTeam?.name ?? (section !== undefined ? t(titles[section] ?? '') : '');

  useEffect(() => {
    void api.ensureSession().then(async (ok) => {
      if (ok) await adoptCacheOwner(queryClient, api.user?.userId);
      setReady(true);
      if (ok) live.connect();
    });
  }, [api, live, queryClient]);

  if (restoring || !ready) return <View className="flex-1 bg-canvas" />;
  if (!api.isAuthenticated()) return <Redirect href="/login" />;
  if (api.user?.needsProfileCompletion && !pathname.startsWith('/complete-profile')) {
    return <Redirect href="/complete-profile" />;
  }

  const nested = !Object.prototype.hasOwnProperty.call(titles, pathname);
  const canCreateChannel = channelTeams.length > 0;
  const onTeams = pathname === '/teams';
  const showCreate = api.user === undefined || canCreateTeam(api.user.accountKind);
  const openTeamAction = (action: 'join' | 'create'): void => {
    router.push({ pathname: '/teams', params: { action } });
  };
  const openChatAction = (action: 'private' | 'channel'): void => {
    router.push({ pathname: '/chats', params: { action } });
  };

  // Schedule and chats follow the restored team list, which survives a refresh.
  const tabs = [
    ...(teams.length > 0
      ? [
          { href: '/schedule' as const, label: t('nav.schedule') },
          { href: '/chats' as const, label: t('nav.chats') },
        ]
      : []),
    { href: '/teams' as const, label: t('nav.teams') },
    { href: '/profile' as const, label: t('nav.profile') },
  ];

  return (
    <View className="flex-1 bg-canvas">
      <LinearGradient
        colors={brand.stops}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ paddingTop: Platform.OS === 'web' ? 0 : 48 }}
      >
      <View className="h-20 items-center justify-center">
        {nested ? (
          <Pressable
            className="absolute bottom-0 left-2 top-0 w-11 items-center justify-center"
            onPress={() => router.replace(parentPath(pathname))}
            accessibilityRole="button"
          >
            <ChevronLeft color={brand.onPrimary} size={24} strokeWidth={2} />
          </Pressable>
        ) : null}
        <View className="max-w-full justify-center">
          {logoUrl !== undefined ? (
            <Image
              source={{ uri: logoUrl }}
              accessibilityLabel={t('teamAdmin.teamLogo')}
              contentFit="contain"
              style={{ position: 'absolute', right: '100%', top: -17, width: 56, height: 56, marginRight: 8 }}
            />
          ) : null}
          <Text
            className="text-lg font-semibold"
            numberOfLines={1}
            style={{ color: brand.onPrimary, fontSize: 18, lineHeight: 22 }}
          >
            {headerName}
          </Text>
        </View>
      </View>
      {onTeams ? (
        <HeaderLinks
          color={brand.onPrimary}
          left={{ label: t('teams.joinTeam'), onPress: () => openTeamAction('join') }}
          right={showCreate ? { label: t('teams.createTeam'), onPress: () => openTeamAction('create') } : undefined}
        />
      ) : null}
      {onChats ? (
        <HeaderLinks
          color={brand.onPrimary}
          left={{ label: t('chats.add'), onPress: () => openChatAction('private') }}
          right={canCreateChannel ? { label: t('chats.newChannel'), onPress: () => openChatAction('channel') } : undefined}
        />
      ) : null}
      </LinearGradient>
      <View className="flex-1">
        <PullRefreshProvider>
          <Slot />
        </PullRefreshProvider>
      </View>
      <View className="flex-row border-t border-line bg-raised pb-6 pt-2">
        {tabs.map((tab) => {
          const Icon = tabIcons[tab.href];
          const active = pathname.startsWith(tab.href);
          const color = active ? brand.primary : colors.muted;
          return (
            <Pressable key={tab.href} className="flex-1 items-center" onPress={() => router.push(tab.href)}>
              <Icon color={color} size={24} strokeWidth={2} />
              <Text className={active ? 'font-bold' : 'text-muted'} style={active ? { color } : undefined}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const HeaderLinks = ({
  color,
  left,
  right,
}: {
  color: string;
  left: { label: string; onPress: () => void };
  right?: { label: string; onPress: () => void };
}) => (
  <View className="flex-row items-center justify-between px-4 pb-2">
    <Pressable onPress={left.onPress} accessibilityRole="button">
      <Text style={{ color }}>{left.label}</Text>
    </Pressable>
    {right !== undefined ? (
      <Pressable onPress={right.onPress} accessibilityRole="button">
        <Text style={{ color }}>{right.label}</Text>
      </Pressable>
    ) : (
      <View />
    )}
  </View>
);

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
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canCreateTeam } from '@gameplan/rules';
import { useDownloadUrl } from '@/src/media';
import {
  consumePendingInvite,
  inviteCodeToRemember,
  readPendingInvite,
  savePendingInvite,
} from '@/src/pending-invite';
import { adoptCacheOwner } from '@/src/query-client';
import { useLiveQuerySync } from '@/src/use-live-query-sync';
import { HelpButton } from '@/src/help-menu';
import { NotificationPrompt } from '@/src/notification-prompt';
import { PullRefreshProvider } from '@/src/pull-refresh';
import { refreshPushRegistration } from '@/src/push';
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

/**
 * One level up. A member, the album, the payments page, or the waivers page returns to that team;
 * dues and waivers return to the profile, orgs to teams.
 */
const parentPath = (pathname: string): string => {
  const teamPage = /^\/teams\/([^/]+)\/(members\/[^/]+|payments|plans|album|waivers)$/.exec(pathname);
  if (teamPage !== null) return `/teams/${teamPage[1]}`;
  if (pathname === '/dues' || pathname === '/waivers') return '/profile';
  if (pathname === '/orgs') return '/teams';
  if (pathname.startsWith('/orgs/')) return '/orgs';
  return Object.keys(titles).find((path) => pathname.startsWith(`${path}/`)) ?? '/teams';
};

export default function MainLayout() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { api, brand, brandTeam, live, teams, selectTeam } = useApp();
  const queryClient = useQueryClient();
  const restoring = useIsRestoring();
  useLiveQuerySync();
  const [ready, setReady] = useState(api.isAuthenticated());
  const [joiningInvite, setJoiningInvite] = useState(false);
  const selectTeamRef = useRef(selectTeam);
  const replaceRef = useRef(router.replace);
  selectTeamRef.current = selectTeam;
  replaceRef.current = router.replace;
  const logoUrl = useDownloadUrl(brandTeam?.theme?.logoKey, { teamId: brandTeam?.teamId });
  const onChats = pathname === '/chats';
  const channelTeams = useTeamsWithPermission('create_team_channels', onChats);
  const section = Object.keys(titles).find((path) => pathname === path || pathname.startsWith(`${path}/`));
  const headerName = brandTeam?.name ?? (section !== undefined ? t(titles[section] ?? '') : '');

  useEffect(() => {
    void api.ensureSession().then(async (ok) => {
      if (ok) await adoptCacheOwner(queryClient, api.user?.userId);
      setReady(true);
      if (ok) {
        live.connect();
        void refreshPushRegistration(api);
      }
    });
  }, [api, live, queryClient]);

  useEffect(() => {
    if (!ready || restoring) return;
    const code = inviteCodeToRemember(
      pathname,
      api.isAuthenticated(),
      api.user?.needsProfileCompletion === true,
    );
    if (code === undefined) return;
    void savePendingInvite(code);
  }, [api, pathname, ready, restoring]);

  useEffect(() => {
    if (!ready || restoring) return;
    if (!api.isAuthenticated() || api.user?.needsProfileCompletion === true) return;
    let cancelled = false;
    void (async () => {
      const code = await readPendingInvite();
      if (cancelled || code === undefined) return;
      setJoiningInvite(true);
      const result = await consumePendingInvite(api, queryClient);
      if (cancelled) return;
      if (result.status === 'joined') {
        selectTeamRef.current(result.teamId);
        replaceRef.current('/schedule');
      } else if (result.status === 'failed') {
        replaceRef.current(`/invite/${encodeURIComponent(result.code)}`);
      }
      setJoiningInvite(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, queryClient, ready, restoring, api.user?.needsProfileCompletion]);

  if (restoring || !ready || joiningInvite) return <View className="flex-1 bg-canvas" />;
  if (!api.isAuthenticated()) return <Redirect href="/login" />;
  if (api.user?.needsProfileCompletion && !pathname.startsWith('/complete-profile')) {
    return <Redirect href="/complete-profile" />;
  }

  // With one team, that team's page stands in for the list: the tab opens it, it carries join and create,
  // and pages that would go back to the list go back to it.
  const onlyTeam = teams.length === 1 ? teams[0] : undefined;
  const onlyTeamPath = onlyTeam !== undefined ? `/teams/${onlyTeam.teamId}` : undefined;
  const nested = !Object.prototype.hasOwnProperty.call(titles, pathname) && pathname !== onlyTeamPath;
  const backPath = (): string => {
    const parent = parentPath(pathname);
    return parent === '/teams' && onlyTeamPath !== undefined ? onlyTeamPath : parent;
  };
  const canCreateChannel = channelTeams.length > 0;
  const onTeams = pathname === '/teams' || pathname === onlyTeamPath;
  const showCreate = api.user === undefined || canCreateTeam(api.user.accountKind);
  const openTeamAction = (action: 'join' | 'create'): void => {
    router.push({ pathname: '/teams', params: { action } });
  };
  const openChatAction = (action: 'private' | 'channel'): void => {
    router.push({ pathname: '/chats', params: { action } });
  };

  const openTab = (href: keyof typeof tabIcons): void => {
    if (href !== '/teams' || onlyTeam === undefined || onlyTeamPath === undefined) {
      router.push(href);
      return;
    }
    selectTeam(onlyTeam.teamId);
    router.push(onlyTeamPath);
  };

  // Schedule and chats follow the restored team list, which survives a refresh.
  const tabs = [
    ...(teams.length > 0
      ? [
          { href: '/schedule' as const, label: t('nav.schedule') },
          { href: '/chats' as const, label: t('nav.chats') },
        ]
      : []),
    { href: '/teams' as const, label: onlyTeam !== undefined ? t('nav.team') : t('nav.teams') },
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
      <View className="h-20 items-center justify-center px-14">
        {nested ? (
          <Pressable
            className="absolute bottom-0 left-2 top-0 w-11 items-center justify-center"
            onPress={() => router.replace(backPath())}
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
        {pathname === '/profile' ? <HelpButton color={brand.onPrimary} /> : null}
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
      <NotificationPrompt />
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
            <Pressable key={tab.href} className="flex-1 items-center" onPress={() => openTab(tab.href)}>
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

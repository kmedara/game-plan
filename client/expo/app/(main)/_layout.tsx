/**
 * Signed-in shell: header, team switcher, and bottom navigation.
 */

import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canCreateTeam } from '@gameplan/rules';
import { useApp } from '@/src/state';

const titles: Record<string, string> = {
  '/schedule': 'title.schedule',
  '/chats': 'title.chats',
  '/teams': 'title.teams',
  '/profile': 'title.profile',
  '/invite': 'title.invite',
};

/** One level up. A member returns to that team; everything else returns to its section. */
const parentPath = (pathname: string): string => {
  const member = /^\/teams\/([^/]+)\/members\/[^/]+$/.exec(pathname);
  if (member !== null) return `/teams/${member[1]}`;
  return Object.keys(titles).find((path) => pathname.startsWith(`${path}/`)) ?? '/teams';
};

export default function MainLayout() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { api, teams, refreshTeams, brand, live } = useApp();
  const [ready, setReady] = useState(api.isAuthenticated());
  const [canCreateChannel, setCanCreateChannel] = useState(false);
  const onChats = pathname === '/chats';

  useEffect(() => {
    void api.refreshSession().then((ok) => {
      setReady(true);
      if (ok) {
        live.connect();
        void refreshTeams();
      }
    });
  }, [api, live]);

  useEffect(() => {
    const teamId = api.selectedTeamId;
    if (!onChats || teamId === undefined) return;
    const role = teams.find((team) => team.teamId === teamId)?.role;
    if (role === undefined) return;
    void api.getPermissions(teamId).then((permissions) => {
      const mine = permissions.roles.find((row) => row.role === role);
      setCanCreateChannel(mine?.permissions.includes('create_team_channels') ?? false);
    }).catch(() => setCanCreateChannel(false));
  }, [api, onChats, teams]);

  if (!ready) return <View className="flex-1 bg-canvas" />;
  if (!api.isAuthenticated()) return <Redirect href="/login" />;
  if (api.user?.needsProfileCompletion && !pathname.startsWith('/complete-profile')) {
    return <Redirect href="/complete-profile" />;
  }

  const nested = !Object.prototype.hasOwnProperty.call(titles, pathname);
  const activeTeam = teams.find((team) => team.teamId === api.selectedTeamId);
  const onTeams = pathname === '/teams';
  const showCreate = api.user === undefined || canCreateTeam(api.user.accountKind);
  const openTeamAction = (action: 'join' | 'create'): void => {
    router.push({ pathname: '/teams', params: { action } });
  };
  const openChatAction = (action: 'private' | 'channel'): void => {
    router.push({ pathname: '/chats', params: { action } });
  };

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
    <View className="flex-1 bg-canvas">
      <LinearGradient
        colors={brand.stops}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ paddingTop: Platform.OS === 'web' ? 0 : 48 }}
      >
      <View className="h-14 items-center justify-center px-12">
        {nested ? (
          <Pressable
            className="absolute bottom-0 left-4 top-0 justify-center"
            onPress={() => router.replace(parentPath(pathname))}
            accessibilityRole="button"
          >
            <Text className="text-lg font-semibold" style={{ color: brand.onPrimary, fontSize: 18, lineHeight: 22 }}>❮</Text>
          </Pressable>
        ) : null}
        <Text
          className="text-lg font-semibold"
          numberOfLines={1}
          style={{ color: brand.onPrimary, fontSize: 18, lineHeight: 22 }}
        >
          {activeTeam?.name ?? ''}
        </Text>
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
        <Slot />
      </View>
      <View className="flex-row border-t border-line bg-raised pb-6 pt-2">
        {tabs.map((tab) => (
          <Pressable key={tab.href} className="flex-1 items-center" onPress={() => router.push(tab.href)}>
            <Text
              className={pathname.startsWith(tab.href) ? 'font-bold' : 'text-muted'}
              style={pathname.startsWith(tab.href) ? { color: brand.accent } : undefined}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
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

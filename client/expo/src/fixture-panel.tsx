/**
 * Share a game with another club, accept an incoming proposal, and open the staff thread.
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Fixture, GameSide, ScheduleOccurrence } from '@gameplan/types';
import { errorMessageKey } from './errors';
import {
  acceptFixtureMutation,
  declineFixtureMutation,
  proposeFixtureMutation,
  unlinkFixtureMutation,
} from './queries/schedule';
import { directoryQuery } from './queries/teams';
import { useApp } from './state';
import { Button, ErrorText } from './ui';

const fixtureErrorKey = (err: unknown): string =>
  errorMessageKey(err, 'errors.common.saveFailed');

/**
 * Incoming proposals for clubs the viewer staffs.
 *
 * @param fixtures - Every fixture loaded for the viewer's teams.
 * @param teamIds - Teams the viewer can accept for.
 * @param games - Unlinked games already on those calendars.
 */
export const IncomingFixtures = ({
  fixtures,
  teamIds,
  games,
}: {
  fixtures: readonly Fixture[];
  teamIds: readonly string[];
  games: readonly (ScheduleOccurrence & { teamId: string })[];
}) => {
  const incoming = fixtures.filter(
    (fixture) => fixture.status === 'proposed' && teamIds.includes(fixture.inviteeTeamId),
  );
  if (incoming.length === 0) return null;
  return (
    <View className="mb-4">
      {incoming.map((fixture) => (
        <IncomingFixture
          key={fixture.fixtureId}
          fixture={fixture}
          games={games.filter((game) => game.teamId === fixture.inviteeTeamId && game.fixtureId === undefined)}
        />
      ))}
    </View>
  );
};

const IncomingFixture = ({
  fixture,
  games,
}: {
  fixture: Fixture;
  games: readonly ScheduleOccurrence[];
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const accept = useMutation(acceptFixtureMutation(api, queryClient));
  const decline = useMutation(declineFixtureMutation(api, queryClient));
  const [eventId, setEventId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const teamIds = [fixture.proposerTeamId, fixture.inviteeTeamId];

  const run = async (task: () => Promise<unknown>): Promise<void> => {
    setError(undefined);
    try {
      await task();
    } catch (err) {
      setError(t(fixtureErrorKey(err)));
    }
  };

  return (
    <View className="mb-3 rounded-xl bg-inset p-3">
      <Text className="font-semibold text-ink">
        {t('schedule.fixtureIncoming', { home: fixture.homeName, away: fixture.awayName })}
      </Text>
      <Text className="text-muted">{fixture.location ?? t('schedule.noLocation')}</Text>
      <ErrorText message={error} />
      {games.map((game) => (
        <Pressable key={game.eventId} className="py-1" onPress={() => setEventId(game.eventId)}>
          <Text className={eventId === game.eventId ? 'font-bold text-ink' : 'text-ink'}>
            {t('schedule.fixtureUseGame', { title: game.title })}
          </Text>
        </Pressable>
      ))}
      <Button
        label={t('schedule.fixtureAccept')}
        onPress={() => {
          void run(() =>
            accept.mutateAsync({
              fixtureId: fixture.fixtureId,
              body: eventId === undefined ? {} : { eventId },
            }),
          );
        }}
      />
      <Button
        label={t('schedule.fixtureDecline')}
        tone="secondary"
        onPress={() => {
          void run(() => decline.mutateAsync({ fixtureId: fixture.fixtureId, teamIds }));
        }}
      />
    </View>
  );
};

/**
 * Opponent, share, and thread for one game.
 *
 * @param item - The occurrence being viewed.
 * @param teamId - The club that owns the occurrence.
 * @param canShare - Whether the viewer holds `manage_events` for that club.
 * @param fixture - The shared fixture, when this game has one.
 */
export const GameFixture = ({
  item,
  teamId,
  canShare,
  fixture,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  canShare: boolean;
  fixture: Fixture | undefined;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const router = useRouter();
  const queryClient = useQueryClient();
  const propose = useMutation(proposeFixtureMutation(api, queryClient));
  const decline = useMutation(declineFixtureMutation(api, queryClient));
  const unlink = useMutation(unlinkFixtureMutation(api, queryClient));
  const [sharing, setSharing] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | undefined>();
  const directory = useInfiniteQuery({ ...directoryQuery(api, debounced), enabled: sharing });
  const hits = (directory.data?.pages.flatMap((page) => page.teams) ?? []).filter((hit) => hit.teamId !== teamId);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(handle);
  }, [query]);

  if (item.eventType !== 'game') return null;

  const run = async (task: () => Promise<unknown>): Promise<void> => {
    setError(undefined);
    try {
      await task();
    } catch (err) {
      setError(t(fixtureErrorKey(err)));
    }
  };

  const sideLabel = (side: GameSide | undefined): string =>
    side === 'home' ? t('schedule.home') : side === 'away' ? t('schedule.away') : '';

  return (
    <View className="mt-4">
      {item.opponentName !== undefined ? (
        <Text className="text-ink">
          {sideLabel(item.side)} {item.opponentName}
        </Text>
      ) : null}
      <ErrorText message={error} />
      {fixture?.status === 'linked' && fixture.chatId !== undefined && canShare ? (
        <Button
          label={t('schedule.fixtureThread')}
          onPress={() => router.push(`/chats/${fixture.chatId}`)}
        />
      ) : null}
      {fixture?.status === 'proposed' && fixture.proposerTeamId === teamId ? (
        <Text className="mb-2 text-muted">{t('schedule.fixturePending')}</Text>
      ) : null}
      {canShare && fixture !== undefined ? (
        <Button
          label={fixture.status === 'linked' ? t('schedule.fixtureUnlink') : t('schedule.fixtureDecline')}
          tone="secondary"
          onPress={() => {
            const teamIds = [fixture.proposerTeamId, fixture.inviteeTeamId];
            void run(() =>
              fixture.status === 'linked'
                ? unlink.mutateAsync({ fixtureId: fixture.fixtureId, teamIds })
                : decline.mutateAsync({ fixtureId: fixture.fixtureId, teamIds }),
            );
          }}
        />
      ) : null}
      {canShare && fixture === undefined && !item.recurring ? (
        sharing ? (
          <View className="mt-2">
            <Text className="mb-1 text-sm text-muted">{t('schedule.fixtureShareWith')}</Text>
            <TextInput
              className="mb-2 rounded-xl border border-line bg-inset px-3 py-2 text-base text-ink"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {hits.map((hit) => (
              <Pressable
                key={hit.teamId}
                className="mb-1 py-1"
                onPress={() => {
                  void run(async () => {
                    await propose.mutateAsync({ teamId, eventId: item.eventId, body: { teamId: hit.teamId } });
                    setSharing(false);
                  });
                }}
              >
                <Text className="text-ink">{hit.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Button label={t('schedule.fixtureShare')} onPress={() => setSharing(true)} />
        )
      ) : null}
    </View>
  );
};

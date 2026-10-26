/**
 * Team album: every member sees, adds, and deletes photos and videos.
 * The plan sets storage and video.
 */

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import Play from 'lucide-react-native/icons/play';
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { AlbumItem } from '@gameplan/types';
import { albumFailureKey, formatClipLength, formatStorage } from '@/src/album';
import { errorMessageKey, queryError } from '@/src/errors';
import { pickAndUploadAlbumFiles, useDownloadUrl, type AlbumUploadFailure } from '@/src/media';
import { openLink } from '@/src/open-link';
import { teamEntitlements } from '@/src/plan';
import { RefreshableScroll } from '@/src/pull-refresh';
import { albumQuery } from '@/src/queries/album';
import { queryKeys } from '@/src/queries/keys';
import { downloadQuery } from '@/src/queries/media';
import { teamQuery } from '@/src/queries/teams';
import { useApp, useBrandTeam } from '@/src/state';
import { Button, ErrorText } from '@/src/ui';
import { UpgradeCard } from '@/src/upgrade-card';

export default function TeamAlbumScreen() {
  const { t, i18n } = useTranslation();
  const { api, teams } = useApp();
  const queryClient = useQueryClient();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const id = teamId ?? '';
  const enabled = id.length > 0;
  useBrandTeam(enabled ? id : undefined);
  const summary = teams.find((team) => team.teamId === id);
  const teamLoaded = useQuery({ ...teamQuery(api, id), enabled });
  const album = useInfiniteQuery({ ...albumQuery(api, id), enabled });
  const entitlements = teamEntitlements(teamLoaded.data ?? summary);
  const items = album.data?.pages.flatMap((page) => page.items) ?? [];
  const usedBytes = album.data?.pages[0]?.usedBytes ?? 0;
  const [progress, setProgress] = useState<{ current: number; total: number } | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [storageFull, setStorageFull] = useState(false);
  const [viewing, setViewing] = useState<AlbumItem | undefined>();

  useEffect(() => {
    const loadError = queryError(album.error);
    if (loadError !== undefined) setError(t(errorMessageKey(loadError, 'errors.common.loadFailed')));
  }, [album.error, t]);

  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: queryKeys.album(id) });

  const reportFailures = (failures: AlbumUploadFailure[]): void => {
    const first = failures[0];
    if (first === undefined) return;
    setStorageFull(failures.includes('plan_limit_reached'));
    const reason = t(albumFailureKey(first));
    setError(failures.length === 1 ? reason : `${t('album.someFailed', { count: failures.length })} ${reason}`);
  };

  const add = async (): Promise<void> => {
    setError(undefined);
    setNotice(undefined);
    setStorageFull(false);
    try {
      const result = await pickAndUploadAlbumFiles(api, id, { limits: entitlements, usedBytes }, (done, total) =>
        setProgress({ current: done + 1, total }),
      );
      if (result === undefined) return;
      if (result.added.length > 0) {
        setNotice(t('album.addedCount', { count: result.added.length }));
        await refresh();
      }
      reportFailures(result.failures);
    } finally {
      setProgress(undefined);
    }
  };

  const play = async (item: AlbumItem): Promise<void> => {
    setError(undefined);
    try {
      await openLink(await queryClient.fetchQuery(downloadQuery(api, item.objectKey, { teamId: id })));
    } catch (err) {
      setError(t(errorMessageKey(err, 'errors.common.loadFailed')));
    }
  };

  const remove = async (item: AlbumItem): Promise<void> => {
    try {
      await api.removeAlbumItem(id, item.itemId);
      setViewing(undefined);
      setNotice(t('album.removed'));
      await refresh();
    } catch (err) {
      setViewing(undefined);
      setError(t(errorMessageKey(err, 'errors.common.deleteFailed')));
    }
  };

  const ready = enabled && album.data !== undefined;

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <Text className="mb-1 text-lg font-semibold text-ink">{t('album.title')}</Text>
      {ready ? (
        <Text className="mb-3 text-muted">
          {t('album.usage', {
            used: formatStorage(usedBytes, i18n.language),
            limit: formatStorage(entitlements.albumBytes, i18n.language),
          })}
        </Text>
      ) : null}
      <ErrorText message={error} />
      {notice !== undefined ? <Text className="mb-2 text-base text-ink">{notice}</Text> : null}
      {storageFull && entitlements.tier === 'free' ? (
        <UpgradeCard teamId={id} message={t('album.storageUpgrade')} />
      ) : null}
      <Button
        label={
          progress !== undefined
            ? t('album.adding', progress)
            : t(entitlements.video ? 'album.addWithVideo' : 'album.add')
        }
        disabled={progress !== undefined}
        onPress={() => void add()}
      />
      {!entitlements.video && !storageFull ? (
        <UpgradeCard teamId={id} message={t('album.videoUpgrade')} />
      ) : null}
      {ready && items.length === 0 ? (
        <Text className="mt-2 text-muted">{t('album.empty')}</Text>
      ) : null}
      <View className="-mx-px mb-3 flex-row flex-wrap">
        {items.map((item) => (
          <AlbumTile
            key={item.itemId}
            item={item}
            teamId={id}
            onPress={() => setViewing(item)}
          />
        ))}
      </View>
      {album.hasNextPage ? (
        <Button
          label={t('album.loadMore')}
          tone="secondary"
          busy={album.isFetchingNextPage}
          onPress={() => void album.fetchNextPage()}
        />
      ) : null}
      <AlbumViewer
        item={viewing}
        teamId={id}
        onPlay={(item) => void play(item)}
        onRemove={(item) => remove(item)}
        onClose={() => setViewing(undefined)}
      />
    </RefreshableScroll>
  );
}

/** One square in the grid. Photos load their image; videos show a play mark and length. */
const AlbumTile = ({ item, teamId, onPress }: { item: AlbumItem; teamId: string; onPress: () => void }) => {
  const { t } = useTranslation();
  const uri = useDownloadUrl(item.kind === 'photo' ? item.objectKey : undefined, { teamId });
  return (
    <Pressable
      style={{ width: '33.333%', aspectRatio: 1, padding: 1 }}
      onPress={onPress}
      accessibilityRole={item.kind === 'video' ? 'button' : 'imagebutton'}
      accessibilityLabel={item.kind === 'video' ? t('album.play') : t('album.photo')}
    >
      <View className="flex-1 items-center justify-center overflow-hidden bg-inset">
        {item.kind === 'photo' ? (
          uri !== undefined ? (
            <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : null
        ) : (
          <>
            <View className="h-10 w-10 items-center justify-center rounded-full bg-black/60">
              <Play size={18} color="#ffffff" fill="#ffffff" />
            </View>
            {item.durationSeconds !== undefined ? (
              <Text className="mt-1 text-xs text-muted">{formatClipLength(item.durationSeconds)}</Text>
            ) : null}
          </>
        )}
      </View>
    </Pressable>
  );
};

/** Full-screen photo, or a video's play button, with delete. */
const AlbumViewer = ({
  item,
  teamId,
  onPlay,
  onRemove,
  onClose,
}: {
  item: AlbumItem | undefined;
  teamId: string;
  onPlay: (item: AlbumItem) => void;
  onRemove: (item: AlbumItem) => Promise<void>;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const uri = useDownloadUrl(item?.kind === 'photo' ? item.objectKey : undefined, { teamId });
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    setConfirming(false);
    setRemoving(false);
  }, [item?.itemId]);

  const remove = (): void => {
    if (item === undefined) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setRemoving(true);
    void onRemove(item).finally(() => setRemoving(false));
  };

  return (
    <Modal visible={item !== undefined} animationType="fade" transparent onRequestClose={onClose}>
      <View className="flex-1 bg-black/90" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <Pressable className="flex-1 items-center justify-center" onPress={onClose}>
          {item?.kind === 'video' ? (
            <Pressable
              className="h-20 w-20 items-center justify-center rounded-full bg-white/20"
              accessibilityRole="button"
              accessibilityLabel={t('album.play')}
              onPress={() => onPlay(item)}
            >
              <Play size={32} color="#ffffff" fill="#ffffff" />
            </Pressable>
          ) : uri !== undefined ? (
            <Image source={{ uri }} style={{ width: '100%', height: '80%' }} contentFit="contain" />
          ) : null}
        </Pressable>
        <View className="flex-row justify-center pb-8">
          <Pressable className="mr-8 px-3 py-2" disabled={removing} onPress={remove}>
            <Text className="text-base text-white" style={{ opacity: removing ? 0.5 : 1 }}>
              {confirming ? t('album.removeConfirm') : t('album.remove')}
            </Text>
          </Pressable>
          <Pressable className="px-3 py-2" onPress={onClose}>
            <Text className="text-base text-white">{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

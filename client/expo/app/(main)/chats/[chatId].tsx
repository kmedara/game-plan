/**
 * Message thread with a virtualized list, live updates, and polls.
 */

import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage } from '@gameplan/types';
import Send from 'lucide-react-native/icons/send';
import X from 'lucide-react-native/icons/x';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessageKey, queryError } from '@/src/errors';
import { CHAT_PHOTO_MAX_DIMENSION, pickAndUploadImage, useDownloadUrl, type UploadedImage } from '@/src/media';
import { openLink } from '@/src/open-link';
import { PollBubble, PollComposer } from '@/src/poll';
import { chatsQuery, historyMessages, messagesQuery, sendMessageMutation } from '@/src/queries/chat';
import { membersQuery } from '@/src/queries/teams';
import { useApp, useBrandTeam } from '@/src/state';
import { chatOverlayColor } from '@/src/team-media';
import { colors } from '@/src/theme';
import { ErrorText, ProfilePhoto } from '@/src/ui';

export default function ChatThreadScreen() {
  const { t } = useTranslation();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { api, brand, teams } = useApp();
  const queryClient = useQueryClient();
  const id = chatId ?? '';
  const chatsLoaded = useQuery(chatsQuery(api));
  const chat = chatsLoaded.data?.find((item) => item.chatId === id);
  const team = teams.find((item) => item.teamId === chat?.teamId);
  useBrandTeam(team?.teamId);
  const backgroundKey = id.length > 0 && id === team?.defaultChatId ? team.theme?.chatBackgroundKey : undefined;
  const scrim = chatOverlayColor(team?.theme?.chatBackgroundOverlay);
  const backgroundUri = useDownloadUrl(backgroundKey, { teamId: team?.teamId });
  const messagesLoaded = useInfiniteQuery({ ...messagesQuery(api, id), enabled: id.length > 0 });
  const sendMessage = useMutation(sendMessageMutation(api, queryClient));
  const messages = historyMessages(messagesLoaded.data);
  const loadOlder = (): void => {
    if (messagesLoaded.hasNextPage && !messagesLoaded.isFetchingNextPage) void messagesLoaded.fetchNextPage();
  };
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<UploadedImage[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [pollOpen, setPollOpen] = useState(false);
  const [namedMessageId, setNamedMessageId] = useState<string | undefined>();
  // A private chat has no team, so a sender's profile opens under the first team that lists them.
  const rosters = useQueries({
    queries: teams.map((item) => ({
      ...membersQuery(api, item.teamId),
      enabled: chat !== undefined && chat.teamId === undefined,
    })),
  });
  const profileTeamId = (senderId: string): string | undefined =>
    chat?.teamId ??
    teams.find((_item, index) => rosters[index]?.data?.some((member) => member.userId === senderId))?.teamId;

  const send = async (): Promise<boolean | void> => {
    const attachmentKeys = photos.map((photo) => photo.key);
    if (draft.trim().length === 0 && attachmentKeys.length === 0) return false;
    await sendMessage.mutateAsync({
      chatId: id,
      body: {
        body: draft.trim(),
        ...(attachmentKeys.length > 0 ? { attachmentKeys } : {}),
      },
    });
    setDraft('');
    setPhotos([]);
  };

  const attach = async (): Promise<void> => {
    const result = await pickAndUploadImage(api, { quality: 0.85, maxDimension: CHAT_PHOTO_MAX_DIMENSION });
    if (result === undefined) return;
    if ('error' in result) {
      setError(t('chats.attachFailed'));
      return;
    }
    setPhotos((current) => [...current, result].slice(0, 10));
  };

  const removePhoto = (key: string): void => {
    setPhotos((current) => current.filter((photo) => photo.key !== key));
  };

  return (
    <View className="flex-1">
      {backgroundUri !== undefined ? (
        <>
          <Image source={{ uri: backgroundUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          {scrim !== undefined ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: scrim }]} /> : null}
        </>
      ) : null}
      {/* Inverted, so reaching the end (the oldest loaded message) fetches the page before it.
          No pull-to-refresh: live events keep the thread current, and a pull fights scrolling back. */}
      <FlatList
        data={messages}
        inverted
        keyExtractor={(item) => item.messageId}
        extraData={namedMessageId}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerClassName="px-3 py-3"
        onEndReached={loadOlder}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          messagesLoaded.isFetchingNextPage ? <ActivityIndicator className="py-3" color={colors.field} /> : undefined
        }
        renderItem={({ item }) => {
          const mine = item.senderId === api.user?.userId;
          const content = (
            <>
              {item.poll !== undefined ? (
                <PollBubble message={item} onDark={mine} />
              ) : item.body.length > 0 ? (
                <Text className="text-base text-ink" style={mine ? { color: brand.onPrimary } : undefined}>{item.body}</Text>
              ) : null}
              {item.attachmentKeys?.map((key) => (
                <Attachment key={key} chatId={id} objectKey={key} />
              ))}
            </>
          );
          if (mine) {
            return (
              <View className="mb-3 max-w-[80%] self-end rounded-2xl p-3" style={{ backgroundColor: brand.primary }}>
                {content}
              </View>
            );
          }
          return (
            <View className="mb-3 max-w-[85%] flex-row items-end self-start">
              <SenderAvatar message={item} teamId={profileTeamId(item.senderId)} />
              <Pressable
                className="ml-2 shrink rounded-2xl border border-line bg-paper p-3"
                onPress={() => setNamedMessageId((current) => (current === item.messageId ? undefined : item.messageId))}
              >
                {namedMessageId === item.messageId ? (
                  <Text className="text-sm text-muted">{item.senderDisplayName}</Text>
                ) : null}
                {content}
              </Pressable>
            </View>
          );
        }}
      />
      <View className="border-t border-line bg-raised px-3 pb-4 pt-2">
        <ErrorText
          message={
            error ??
            (queryError(messagesLoaded.error) !== undefined
              ? t(errorMessageKey(messagesLoaded.error, 'errors.common.loadFailed'))
              : undefined)
          }
        />
        {photos.length > 0 ? (
          <View className="mb-2 flex-row flex-wrap">
            {photos.map((photo) => (
              <View key={photo.key} className="mr-2 mb-2">
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: 64, height: 64, borderRadius: 8 }}
                  contentFit="cover"
                />
                <Pressable
                  accessibilityLabel={t('chats.removePhoto')}
                  className="absolute right-1 top-1 h-5 w-5 items-center justify-center rounded-full bg-black/60"
                  onPress={() => removePhoto(photo.key)}
                >
                  <X color="#ffffff" size={12} strokeWidth={2.5} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <View className="flex-row items-center rounded-xl border border-line bg-inset">
          <Pressable
            accessibilityLabel={t('chats.attachPhoto')}
            className="h-10 w-10 items-center justify-center"
            onPress={() => void attach()}
          >
            <CameraIcon />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('polls.new')}
            className="mr-1 h-10 items-center justify-center px-1"
            onPress={() => setPollOpen(true)}
          >
            <Text className="text-sm font-semibold" style={{ color: brand.accent }}>
              {t('polls.button')}
            </Text>
          </Pressable>
          <TextInput
            className="min-w-0 flex-1 px-1 py-2 text-base text-ink"
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chats.message')}
          />
          {draft.trim().length > 0 || photos.length > 0 ? (
            <Pressable
              accessibilityLabel={t('chats.send')}
              className="mr-1 h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: brand.accent }}
              onPress={() => void send().catch((err: unknown) => setError(t(errorMessageKey(err, 'chats.sendFailed'))))}
            >
              <Send color={brand.onPrimary} size={16} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <PollComposer chatId={id} visible={pollOpen} onClose={() => setPollOpen(false)} />
    </View>
  );
}

/** Sender photo beside a message; opens their profile when a shared team is known. */
const SenderAvatar = ({ message, teamId }: { message: ChatMessage; teamId: string | undefined }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const uri = useDownloadUrl(message.senderPhotoKey, { userId: message.senderId });
  const photo = <ProfilePhoto name={message.senderDisplayName} uri={uri} size={28} />;
  if (teamId === undefined) return photo;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('chats.viewProfile', { name: message.senderDisplayName })}
      onPress={() => router.push(`/teams/${teamId}/members/${message.senderId}`)}
    >
      {photo}
    </Pressable>
  );
};

const CameraIcon = () => {
  const { brand } = useApp();
  return (
  <View className="h-5 w-6 items-center">
    <View className="h-1 w-2.5 rounded-t-sm" style={{ backgroundColor: brand.accent }} />
    <View className="h-3.5 w-6 items-center justify-center rounded-sm" style={{ backgroundColor: brand.accent }}>
      <View className="h-2 w-2 rounded-full bg-paper" />
    </View>
  </View>
  );
};

const savePhoto = async (uri: string): Promise<void> => {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const response = await fetch(uri);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'photo.jpg';
    link.click();
    URL.revokeObjectURL(objectUrl);
    return;
  }
  await openLink(uri);
};

const Attachment = ({ chatId, objectKey }: { chatId: string; objectKey: string }) => {
  const { t } = useTranslation();
  const uri = useDownloadUrl(objectKey, { chatId });
  const [open, setOpen] = useState(false);
  if (uri === undefined) return null;
  return (
    <>
      <Pressable accessibilityRole="imagebutton" onPress={() => setOpen(true)}>
        <Image
          source={{ uri }}
          style={{ width: 220, height: 160, marginTop: 8, borderRadius: 8 }}
          contentFit="cover"
        />
      </Pressable>
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-black/90">
          <Pressable className="flex-1 items-center justify-center" onPress={() => setOpen(false)}>
            <Image source={{ uri }} style={{ width: '100%', height: '80%' }} contentFit="contain" />
          </Pressable>
          <View className="flex-row justify-center pb-8">
            <Pressable className="mr-8 px-3 py-2" onPress={() => void savePhoto(uri)}>
              <Text className="text-base text-white">{t('chats.downloadPhoto')}</Text>
            </Pressable>
            <Pressable className="px-3 py-2" onPress={() => setOpen(false)}>
              <Text className="text-base text-white">{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
};

/**
 * Message thread with a virtualized list and live updates.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Send from 'lucide-react-native/icons/send';
import X from 'lucide-react-native/icons/x';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessageKey, queryError } from '@/src/errors';
import { pickAndUploadImage, useDownloadUrl, type UploadedImage } from '@/src/media';
import { chatsQuery, messagesQuery, sendMessageMutation } from '@/src/queries/chat';
import { useApp, useBrandTeam } from '@/src/state';
import { chatOverlayColor } from '@/src/team-media';
import { ErrorText } from '@/src/ui';

export default function ChatThreadScreen() {
  const { t } = useTranslation();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { api, brand, teams } = useApp();
  const queryClient = useQueryClient();
  const id = chatId ?? '';
  const chatsLoaded = useQuery(chatsQuery(api));
  const chat = chatsLoaded.data?.find((item) => item.chatId === id);
  const team = teams.find((item) => item.teamId === chat?.teamId);
  useBrandTeam(teams.length > 1 ? team?.teamId : undefined);
  const backgroundKey = id.length > 0 && id === team?.defaultChatId ? team.theme?.chatBackgroundKey : undefined;
  const scrim = chatOverlayColor(team?.theme?.chatBackgroundOverlay);
  const backgroundUri = useDownloadUrl(backgroundKey, { teamId: team?.teamId });
  const messagesLoaded = useQuery({ ...messagesQuery(api, id), enabled: id.length > 0 });
  const sendMessage = useMutation(sendMessageMutation(api, queryClient));
  const messages = messagesLoaded.data?.messages ?? [];
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<UploadedImage[]>([]);
  const [error, setError] = useState<string | undefined>();

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
    const result = await pickAndUploadImage(api, { quality: 0.8 });
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
          <Image source={{ uri: backgroundUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          {scrim !== undefined ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: scrim }]} /> : null}
        </>
      ) : null}
      <FlatList
        data={messages}
        inverted
        keyExtractor={(item) => item.messageId}
        style={{ backgroundColor: 'transparent' }}
        contentContainerClassName="px-3 py-3"
        renderItem={({ item }) => {
          const mine = item.senderId === api.user?.userId;
          return (
            <View
              className={`mb-3 max-w-[80%] rounded-2xl p-3 ${mine ? 'self-end' : 'self-start border border-line bg-paper'}`}
              style={mine ? { backgroundColor: brand.primary } : undefined}
            >
              {mine ? null : (
                <Text className="text-xs text-muted">{item.senderDisplayName ?? item.senderId}</Text>
              )}
              {item.body.length > 0 ? (
                <Text className="text-ink" style={mine ? { color: brand.onPrimary } : undefined}>{item.body}</Text>
              ) : null}
              {item.attachmentKeys?.map((key) => (
                <Attachment key={key} chatId={id} objectKey={key} />
              ))}
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
                  resizeMode="cover"
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
          <TextInput
            className="flex-1 py-2 text-ink"
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
    </View>
  );
}

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
  await Linking.openURL(uri);
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
          resizeMode="cover"
        />
      </Pressable>
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-black/90">
          <Pressable className="flex-1 items-center justify-center" onPress={() => setOpen(false)}>
            <Image source={{ uri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
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

/**
 * Message thread with a virtualized list and live updates.
 */

import * as ImagePicker from 'expo-image-picker';
import { X } from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@gameplan/types';
import { useActiveTeam, useApp } from '@/src/state';
import { ErrorText, SubmitButton } from '@/src/ui';

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

type PendingPhoto = { key: string; uri: string };

export default function ChatThreadScreen() {
  const { t } = useTranslation();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { api, live, brand } = useApp();
  const { team } = useActiveTeam();
  const id = chatId ?? '';
  const backgroundKey = id.length > 0 && id === team?.defaultChatId ? team.theme?.chatBackgroundKey : undefined;
  const [backgroundUri, setBackgroundUri] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [error, setError] = useState<string | undefined>();

  const addMessage = (message: ChatMessage): void => {
    setMessages((current) => [message, ...current.filter((item) => item.messageId !== message.messageId)]);
  };

  const load = async (): Promise<void> => {
    const page = await api.listMessages(id);
    setMessages(page.messages);
  };

  useEffect(() => {
    const teamId = team?.teamId;
    if (backgroundKey === undefined || teamId === undefined) {
      setBackgroundUri(undefined);
      return;
    }
    let cancelled = false;
    void api.presignDownload(backgroundKey, { teamId }).then((download) => {
      if (!cancelled) setBackgroundUri(download.downloadUrl);
    }).catch(() => {
      if (!cancelled) setBackgroundUri(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [api, backgroundKey, team?.teamId]);

  useEffect(() => {
    if (id.length === 0) return;
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'));
    return live.subscribe((event) => {
      if (event.type !== 'chat_message' || event.chatId !== id) return;
      addMessage({
        messageId: event.messageId,
        chatId: event.chatId,
        senderId: event.senderId,
        senderDisplayName: event.senderDisplayName ?? 'Player',
        body: event.body,
        createdAt: event.createdAt,
        attachmentKeys: event.attachmentKeys,
      });
    });
  }, [api, id, live]);

  const send = async (): Promise<void> => {
    const attachmentKeys = photos.map((photo) => photo.key);
    if (draft.trim().length === 0 && attachmentKeys.length === 0) return;
    const message = await api.sendMessage(id, {
      body: draft.trim(),
      ...(attachmentKeys.length > 0 ? { attachmentKeys } : {}),
    });
    addMessage(message);
    setDraft('');
    setPhotos([]);
  };

  const attach = async (): Promise<void> => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (picked.canceled || picked.assets[0] === undefined) return;
    const asset = picked.assets[0];
    const contentType = asset.mimeType ?? 'image/jpeg';
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    if (blob.size > PHOTO_MAX_BYTES) {
      setError(t('chats.attachFailed'));
      return;
    }
    const presign = await api.presignUpload(contentType, blob.size);
    const upload = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: blob,
    });
    if (!upload.ok) {
      setError(t('chats.attachFailed'));
      return;
    }
    setPhotos((current) => [...current, { key: presign.objectKey, uri: asset.uri }].slice(0, 10));
  };

  const removePhoto = (key: string): void => {
    setPhotos((current) => current.filter((photo) => photo.key !== key));
  };

  return (
    <View className="flex-1">
      {backgroundUri !== undefined ? (
        <>
          <Image source={{ uri: backgroundUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
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
        <ErrorText message={error} />
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
        <View className="mb-2 flex-row items-center">
          <Pressable
            accessibilityLabel={t('chats.attachPhoto')}
            className="mr-2 h-10 w-10 items-center justify-center rounded-full bg-inset"
            onPress={() => void attach()}
          >
            <CameraIcon />
          </Pressable>
          <TextInput
            className="flex-1 rounded-xl border border-line bg-inset px-3 py-2 text-ink"
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chats.message')}
          />
        </View>
        <SubmitButton label={t('chats.send')} onPress={send} color={brand.accent} />
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
  const { api } = useApp();
  const [uri, setUri] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void api
      .presignDownload(objectKey, { chatId })
      .then((download) => setUri(download.downloadUrl))
      .catch(() => undefined);
  }, [api, chatId, objectKey]);
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

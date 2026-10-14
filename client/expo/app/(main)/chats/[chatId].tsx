/**
 * Message thread with a virtualized list and live updates.
 */

import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@gameplan/types';
import { useApp } from '@/src/state';
import { Button, ErrorText } from '@/src/ui';

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export default function ChatThreadScreen() {
  const { t } = useTranslation();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { api, live } = useApp();
  const id = chatId ?? '';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();

  const load = async (): Promise<void> => {
    const page = await api.listMessages(id);
    setMessages(page.messages);
  };

  useEffect(() => {
    if (id.length === 0) return;
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'));
    return live.subscribe((event) => {
      if (event.type !== 'chat_message' || event.chatId !== id) return;
      setMessages((current) => {
        if (current.some((message) => message.messageId === event.messageId)) return current;
        return [
          ...current,
          {
            messageId: event.messageId,
            chatId: event.chatId,
            senderId: event.senderId,
            senderDisplayName: event.senderDisplayName ?? 'Player',
            body: event.body,
            createdAt: event.createdAt,
            attachmentKeys: event.attachmentKeys,
          },
        ];
      });
    });
  }, [api, id, live]);

  const send = async (): Promise<void> => {
    if (draft.trim().length === 0 && attachments.length === 0) return;
    try {
      const message = await api.sendMessage(id, {
        body: draft.trim(),
        ...(attachments.length > 0 ? { attachmentKeys: attachments } : {}),
      });
      setMessages((current) => [...current, message]);
      setDraft('');
      setAttachments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    }
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
    setAttachments((current) => [...current, presign.objectKey].slice(0, 10));
  };

  return (
    <View className="flex-1">
      <FlatList
        data={messages}
        keyExtractor={(item) => item.messageId}
        contentContainerClassName="px-3 py-3"
        renderItem={({ item }) => (
          <View className="mb-3 rounded-lg bg-white p-3">
            <Text className="text-xs text-slate-500">{item.senderDisplayName ?? item.senderId}</Text>
            {item.body.length > 0 ? <Text>{item.body}</Text> : null}
            {item.attachmentKeys?.map((key) => (
              <Attachment key={key} objectKey={key} />
            ))}
          </View>
        )}
      />
      <View className="border-t border-slate-200 bg-white px-3 pb-4 pt-2">
        <ErrorText message={error} />
        <TextInput
          className="mb-2 rounded border border-slate-300 px-3 py-2"
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chats.message')}
        />
        <View className="flex-row">
          <View className="mr-2 flex-1">
            <Button label={t('chats.attachPhoto')} onPress={() => void attach()} color="#334155" />
          </View>
          <View className="flex-1">
            <Button label={t('chats.send')} onPress={() => void send()} />
          </View>
        </View>
      </View>
    </View>
  );
}

const Attachment = ({ objectKey }: { objectKey: string }) => {
  const { api } = useApp();
  const [uri, setUri] = useState<string | undefined>();
  useEffect(() => {
    void api.presignDownload(objectKey).then((download) => setUri(download.downloadUrl)).catch(() => undefined);
  }, [api, objectKey]);
  if (uri === undefined) return null;
  return <Image source={{ uri }} className="mt-2 h-40 w-full rounded" />;
};

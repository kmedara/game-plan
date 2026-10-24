/**
 * Header help button. Opens a short menu for the privacy policy and a support form.
 */

import { useRouter } from 'expo-router';
import CircleQuestionMark from 'lucide-react-native/icons/circle-question-mark';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { config } from './config';
import { errorCode } from './errors';
import { openLink } from './open-link';
import { Sheet } from './sheet';
import { useApp } from './state';
import { Button, Field, SubmitButton } from './ui';

/** Support form. Without a server inbox, it hands the message to the person's mail app. */
const SupportForm = ({ onDone }: { onDone: () => void }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const send = async (): Promise<boolean | void> => {
    if (subject.trim().length === 0) throw new Error('subject_required');
    if (message.trim().length === 0) throw new Error('message_required');
    try {
      await api.sendSupportRequest({ subject: subject.trim(), message: message.trim() });
    } catch (err) {
      if (errorCode(err) !== 'support_not_configured' || config.supportEmail.length === 0) throw err;
      const query = `subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(message.trim())}`;
      await openLink(`mailto:${config.supportEmail}?${query}`);
    }
    setSent(true);
  };

  if (sent) {
    return (
      <View>
        <Text className="mb-4 text-base text-ink">{t('support.sent')}</Text>
        <Button label={t('common.close')} onPress={onDone} />
      </View>
    );
  }

  return (
    <View>
      <Field label={t('support.subject')} value={subject} onChangeText={setSubject} />
      <Field label={t('support.message')} value={message} onChangeText={setMessage} multiline />
      <SubmitButton
        label={t('support.send')}
        loadedText=""
        onPress={send}
        message={(err) => {
          const code = errorCode(err);
          if (code === 'subject_required') return t('support.subjectRequired');
          if (code === 'message_required') return t('support.messageRequired');
          return t('support.sendFailed');
        }}
      />
    </View>
  );
};

export const HelpButton = ({ color }: { color: string }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  return (
    <>
      <Pressable
        className="absolute bottom-0 right-2 top-0 w-11 items-center justify-center"
        onPress={() => setMenuOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('help.title')}
      >
        <CircleQuestionMark color={color} size={24} strokeWidth={2} />
      </Pressable>
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full rounded-2xl bg-raised p-4">
            <Text className="mb-4 text-base font-semibold text-ink">{t('help.title')}</Text>
            <Button
              label={t('auth.privacy')}
              onPress={() => {
                setMenuOpen(false);
                router.push('/privacy');
              }}
            />
            <Button
              label={t('help.contactSupport')}
              onPress={() => {
                setMenuOpen(false);
                setSupportOpen(true);
              }}
            />
            <Button label={t('common.cancel')} tone="secondary" onPress={() => setMenuOpen(false)} />
          </View>
        </View>
      </Modal>
      {/* Mounted only while open, so a closed form starts empty next time. */}
      {supportOpen ? (
        <Sheet
          visible
          title={t('help.contactSupport')}
          closeLabel={t('common.cancel')}
          onClose={() => setSupportOpen(false)}
        >
          <SupportForm onDone={() => setSupportOpen(false)} />
        </Sheet>
      ) : null}
    </>
  );
};

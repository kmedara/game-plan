/**
 * Polls in chat: the bubble people vote in, and the sheet that creates one.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MAX_POLL_OPTIONS, type ChatMessage } from '@gameplan/types';
import { errorMessageKey } from './errors';
import { createPollMutation, votePollMutation } from './queries/chat';
import { Sheet } from './sheet';
import { useApp } from './state';
import { colors } from './theme';
import { Button, ErrorText, Field, SubmitButton } from './ui';

/** Error sentences specific to polls. */
const POLL_ERRORS = {
  poll_closed: 'errors.polls.closed',
  poll_duplicate_option: 'errors.polls.duplicate',
  invalid_body: 'errors.polls.invalid',
} as const;

/**
 * The choices after tapping one option.
 *
 * @param mine - Current choices.
 * @param optionId - The tapped option.
 * @param multiple - Whether several may be picked.
 * @returns The new choices. Tapping a chosen option takes it back.
 */
export const nextChoices = (mine: readonly string[], optionId: string, multiple: boolean): string[] => {
  if (mine.includes(optionId)) return mine.filter((id) => id !== optionId);
  return multiple ? [...mine, optionId] : [optionId];
};

/** A poll inside a chat bubble. */
export const PollBubble = ({ message, onDark }: { message: ChatMessage; onDark: boolean }) => {
  const { t } = useTranslation();
  const { api, brand } = useApp();
  const queryClient = useQueryClient();
  const vote = useMutation(votePollMutation(api, queryClient));
  const [error, setError] = useState<string | undefined>();
  const poll = message.poll;
  if (poll === undefined) return null;
  const tally = message.pollTally ?? { counts: {}, voters: 0, mine: [] };
  const closed = poll.closesAt !== undefined && new Date(poll.closesAt).getTime() <= Date.now();
  const total = Math.max(1, Object.values(tally.counts).reduce((sum, count) => sum + count, 0));
  const text = onDark ? { color: brand.onPrimary } : undefined;

  const choose = (optionId: string): void => {
    if (closed || vote.isPending) return;
    setError(undefined);
    vote.mutate(
      { chatId: message.chatId, messageId: message.messageId, optionIds: nextChoices(tally.mine, optionId, poll.multiple) },
      { onError: (err) => setError(t(errorMessageKey(err, 'errors.common.saveFailed', POLL_ERRORS))) },
    );
  };

  return (
    <View className="min-w-56">
      <Text className="mb-1 text-base font-semibold text-ink" style={text}>
        {poll.question}
      </Text>
      <Text className="mb-2 text-sm text-muted" style={text}>
        {poll.multiple ? t('polls.pickAny') : t('polls.pickOne')}
      </Text>
      {poll.options.map((option) => {
        const count = tally.counts[option.id] ?? 0;
        const chosen = tally.mine.includes(option.id);
        return (
          <Pressable
            key={option.id}
            accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: chosen, disabled: closed }}
            className="mb-1.5 overflow-hidden rounded-lg border"
            style={{ borderColor: chosen ? brand.accent : colors.line }}
            onPress={() => choose(option.id)}
          >
            <View
              className="absolute bottom-0 left-0 top-0"
              style={{ width: `${(count / total) * 100}%`, backgroundColor: brand.accent, opacity: 0.25 }}
            />
            <View className="flex-row justify-between px-2 py-1.5">
              <Text className={`text-base${chosen ? ' font-semibold text-ink' : ' text-ink'}`} style={text}>
                {option.text}
              </Text>
              <Text className="ml-2 text-base text-ink" style={text}>
                {count}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <Text className="text-sm text-muted" style={text}>
        {closed ? t('polls.closed', { count: tally.voters }) : t('polls.votes', { count: tally.voters })}
      </Text>
      <ErrorText message={error} />
    </View>
  );
};

/** Sheet to create a poll in a chat. */
export const PollComposer = ({ chatId, visible, onClose }: { chatId: string; visible: boolean; onClose: () => void }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const create = useMutation(createPollMutation(api, queryClient));
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);

  const reset = (): void => {
    setQuestion('');
    setOptions(['', '']);
    setMultiple(false);
  };

  const submit = async (): Promise<boolean> => {
    const filled = options.map((option) => option.trim()).filter((option) => option.length > 0);
    if (question.trim().length === 0) throw new Error('poll_question_required');
    if (filled.length < 2) throw new Error('poll_two_options');
    await create.mutateAsync({ chatId, body: { question: question.trim(), options: filled, multiple } });
    reset();
    onClose();
    return true;
  };

  return (
    <Sheet visible={visible} title={t('polls.new')} closeLabel={t('common.cancel')} onClose={onClose}>
      <Field label={t('polls.question')} value={question} onChangeText={setQuestion} placeholder={t('polls.questionHint')} />
      {options.map((option, index) => (
        <Field
          key={index}
          label={t('polls.option', { number: index + 1 })}
          value={option}
          onChangeText={(value) => setOptions(options.map((at, i) => (i === index ? value : at)))}
        />
      ))}
      {options.length < MAX_POLL_OPTIONS ? (
        <Button label={t('polls.addOption')} tone="secondary" onPress={() => setOptions([...options, ''])} />
      ) : null}
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-ink">{t('polls.allowMultiple')}</Text>
        <Switch value={multiple} onValueChange={setMultiple} />
      </View>
      <SubmitButton
        label={t('polls.post')}
        loadedText=""
        onPress={submit}
        message={(err) =>
          t(
            errorMessageKey(err, 'errors.common.saveFailed', {
              ...POLL_ERRORS,
              poll_question_required: 'errors.polls.questionRequired',
              poll_two_options: 'errors.polls.twoOptions',
            }),
          )
        }
      />
    </Sheet>
  );
};

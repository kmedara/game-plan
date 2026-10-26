/**
 * Game lineup for one occurrence.
 *
 * Managers reorder players by dragging the grip beside each name. Screen
 * readers get move up and move down actions on the same grip. Tapping a name
 * opens position chips under it, and the cross removes the player.
 *
 * Every change saves on its own, one save at a time so each carries the
 * version the last one returned. A typed position waits until typing pauses.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import GripVertical from 'lucide-react-native/icons/grip-vertical';
import X from 'lucide-react-native/icons/x';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  Text,
  View,
  type AccessibilityActionEvent,
  type LayoutRectangle,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { LineupResponse, LineupSlot, ScheduleOccurrence, TeamMember } from '@gameplan/types';
import { errorCode, errorMessageKey, queryError } from '@/src/errors';
import { noPull } from '@/src/pull-refresh';
import { queryKeys } from '@/src/queries/keys';
import { lineupMutation, lineupQuery } from '@/src/queries/schedule';
import { useApp } from '@/src/state';
import { colors } from '@/src/theme';
import { Button, Chip, ErrorText, Field } from '@/src/ui';

/** Space between lineup rows, which a dragged row also covers when it passes one. */
const ROW_GAP = 12;

/** How long a typed position waits for the next key before it saves. */
const TYPING_SAVE_MS = 800;

/** Same rule as `teamPositionSchema` in `lib/schemas/src/teams.ts`, which the save checks. */
const POSITION = /^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N} .'/+-]*[\p{L}\p{M}\p{N}])?$/u;

/**
 * Whether the server will take a position.
 *
 * @param position - As typed.
 * @returns True for 1 to 40 letters, numbers, and inner punctuation, after trimming.
 */
export const isPosition = (position: string): boolean => {
  const trimmed = position.trim();
  return trimmed.length <= 40 && POSITION.test(trimmed);
};

/** Stops the web page scrolling under the finger and shows a grab cursor. */
const grip: ViewStyle | undefined =
  Platform.OS === 'web' ? ({ touchAction: 'none', cursor: 'grab' } as unknown as ViewStyle) : undefined;

/**
 * Moves one slot to a new place in the lineup.
 *
 * @param slots - The lineup in order.
 * @param from - Index of the slot being moved.
 * @param to - Index it should end up at.
 * @returns A new lineup, unchanged when either index is out of range.
 */
export const moveSlot = <T,>(slots: readonly T[], from: number, to: number): T[] => {
  const moved = slots[from];
  if (moved === undefined || to < 0 || to >= slots.length || from === to) return [...slots];
  const copy = slots.filter((_, index) => index !== from);
  copy.splice(to, 0, moved);
  return copy;
};

/**
 * Where a dragged row would land if released now.
 *
 * The row lands past every other row whose middle its own middle has crossed.
 *
 * @param rows - Each row's top and height, in list order.
 * @param from - Index of the dragged row.
 * @param dy - How far the finger has moved since the drag began.
 * @returns The index the row would take.
 */
export const dropIndex = (rows: readonly Pick<LayoutRectangle, 'y' | 'height'>[], from: number, dy: number): number => {
  const dragged = rows[from];
  if (dragged === undefined) return from;
  const middle = dragged.y + dragged.height / 2 + dy;
  let target = from;
  rows.forEach((row, index) => {
    const rowMiddle = row.y + row.height / 2;
    if (index < from && middle < rowMiddle) target = Math.min(target, index);
    if (index > from && middle > rowMiddle) target = Math.max(target, index);
  });
  return target;
};

/**
 * Positions to offer as chips for one player.
 *
 * @param own - Positions the player set on their profile, offered first.
 * @param others - Positions of the rest of the lineup.
 * @returns Each position once, ignoring case and blanks, in that order.
 */
export const positionChoices = (own: readonly string[] | undefined, others: readonly string[]): string[] => {
  const seen = new Set<string>();
  const choices: string[] = [];
  for (const position of [...(own ?? []), ...others]) {
    const trimmed = position.trim();
    const key = trimmed.toLowerCase();
    if (trimmed === '' || seen.has(key)) continue;
    seen.add(key);
    choices.push(trimmed);
  }
  return choices;
};

const samePosition = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * How far a row moves aside to show where the dragged one will land.
 *
 * @param index - The row.
 * @param from - The dragged row.
 * @param to - Where the dragged row would land.
 * @param step - The dragged row's height plus the gap below it.
 * @returns The offset in pixels.
 */
const shiftFor = (index: number, from: number, to: number, step: number): number => {
  if (index > from && index <= to) return -step;
  if (index < from && index >= to) return step;
  return 0;
};

type Drag = { from: number; to: number };

/**
 * One lineup row that follows the finger while its grip is held.
 */
const DraggableRow = ({
  label,
  moveUpLabel,
  moveDownLabel,
  offset,
  shift,
  dragging,
  onLayout,
  onStart,
  onMove,
  onEnd,
  onStep,
  header,
  children,
}: {
  label: string;
  moveUpLabel: string;
  moveDownLabel: string;
  offset: Animated.Value;
  shift: number;
  dragging: boolean;
  onLayout: (layout: LayoutRectangle) => void;
  onStart: () => void;
  onMove: (dy: number) => void;
  onEnd: (dy: number) => void;
  onStep: (direction: -1 | 1) => void;
  header: ReactNode;
  children: ReactNode;
}) => {
  // The responder is made once, so it reads the latest handlers from a ref.
  const handlers = useRef({ onStart, onMove, onEnd });
  handlers.current = { onStart, onMove, onEnd };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => handlers.current.onStart(),
      onPanResponderMove: (_, gesture) => handlers.current.onMove(gesture.dy),
      onPanResponderRelease: (_, gesture) => handlers.current.onEnd(gesture.dy),
      onPanResponderTerminate: (_, gesture) => handlers.current.onEnd(gesture.dy),
    }),
  ).current;

  const onAction = (event: AccessibilityActionEvent): void => {
    if (event.nativeEvent.actionName === 'moveUp') onStep(-1);
    if (event.nativeEvent.actionName === 'moveDown') onStep(1);
  };

  return (
    <Animated.View
      onLayout={(event) => onLayout(event.nativeEvent.layout)}
      style={{
        marginBottom: ROW_GAP,
        zIndex: dragging ? 1 : 0,
        opacity: dragging ? 0.85 : 1,
        transform: [{ translateY: dragging ? offset : shift }],
      }}
    >
      <View className="mb-1 flex-row items-center">
        <View
          ref={noPull}
          {...responder.panHandlers}
          style={grip}
          className="mr-2 p-1"
          accessible
          accessibilityLabel={label}
          accessibilityActions={[
            { name: 'moveUp', label: moveUpLabel },
            { name: 'moveDown', label: moveDownLabel },
          ]}
          onAccessibilityAction={onAction}
        >
          <GripVertical size={20} color={colors.muted} strokeWidth={2} />
        </View>
        {header}
      </View>
      {children}
    </Animated.View>
  );
};

/**
 * A player's name with their position in small text beneath it.
 *
 * @param placeholder - Shown in place of a blank position, when it can be set.
 * @param editable - Adds a chevron to show that tapping opens the positions.
 */
const SlotName = ({
  name,
  position,
  placeholder,
  editable,
}: {
  name: string;
  position: string;
  placeholder?: string;
  editable?: boolean;
}) => {
  const shown = position.trim() !== '' ? position : placeholder;
  return (
    <View className="flex-1">
      <Text className="text-base text-ink">{name}</Text>
      {shown !== undefined ? (
        <View className="flex-row items-center">
          <Text className="text-sm text-muted">{shown}</Text>
          {editable === true ? <ChevronDown size={14} color={colors.muted} strokeWidth={2} /> : null}
        </View>
      ) : null}
    </View>
  );
};

export const LineupEditor = ({
  item,
  teamId,
  roster,
  canManage,
  nameOf,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  roster: TeamMember[];
  canManage: boolean;
  nameOf: (userId: string) => string;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const lineup = useQuery(lineupQuery(api, teamId, item.eventId, item.startsAt));
  const saveLineup = useMutation(lineupMutation(api, queryClient));
  const [slots, setSlots] = useState<LineupSlot[] | undefined>(undefined);
  const shownSlots = slots ?? lineup.data?.slots ?? [];
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const shown = error ?? (queryError(lineup.error) !== undefined ? t('errors.event.lineupLoadFailed') : undefined);
  const [drag, setDrag] = useState<Drag | undefined>();
  // The one row whose position chips are open, and whether it is typing its own.
  const [openSlot, setOpenSlot] = useState<string | undefined>();
  const [custom, setCustom] = useState(false);
  const [status, setStatus] = useState<'saving' | 'saved' | undefined>();
  // The newest lineup not yet sent, whether a save is in flight, and a typed position's timer.
  const pending = useRef<LineupSlot[] | undefined>(undefined);
  const saving = useRef(false);
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragOffset = useRef(new Animated.Value(0)).current;
  const rows = useRef<LayoutRectangle[]>([]);
  const dragStep = drag !== undefined ? (rows.current[drag.from]?.height ?? 0) + ROW_GAP : 0;

  useEffect(() => {
    setSlots(undefined);
    setOpenSlot(undefined);
    setStatus(undefined);
    // Leaving this game, or the screen, still saves a position mid-typing.
    return () => {
      if (typing.current === undefined) return;
      clearTimeout(typing.current);
      typing.current = undefined;
      void flush();
    };
    // The cleanup keeps this game's `flush`, so it saves to the game being left.
  }, [item.eventId, item.startsAt]);

  // Layouts are kept per index, so drop the ones past the end when the lineup shrinks.
  rows.current.length = Math.min(rows.current.length, shownSlots.length);

  const startDrag = (from: number): void => {
    dragOffset.setValue(0);
    setDrag({ from, to: from });
  };

  const moveDrag = (from: number, dy: number): void => {
    dragOffset.setValue(dy);
    const to = dropIndex(rows.current, from, dy);
    setDrag((current) => (current?.to === to ? current : { from, to }));
  };

  const endDrag = (from: number, dy: number): void => {
    const to = dropIndex(rows.current, from, dy);
    dragOffset.setValue(0);
    setDrag(undefined);
    if (to !== from) change(moveSlot(shownSlots, from, to));
  };

  /** Sends the newest lineup until none is waiting. Only one runs at a time. */
  const flush = async (): Promise<void> => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (pending.current !== undefined) {
        const next = pending.current;
        pending.current = undefined;
        setStatus('saving');
        // The cache holds the version the last save returned.
        const version = queryClient.getQueryData<LineupResponse>(
          queryKeys.lineup(teamId, item.eventId, item.startsAt),
        )?.version;
        try {
          await saveLineup.mutateAsync({
            teamId,
            body: {
              eventId: item.eventId,
              occurrenceStartsAt: item.startsAt,
              slots: next,
              ...(version !== undefined ? { version } : {}),
            },
          });
        } catch (err) {
          pending.current = undefined;
          setStatus(undefined);
          if (errorCode(err) === 'lineup_changed') {
            // Someone else saved first. Show their lineup rather than overwrite it.
            setSlots(undefined);
            setOpenSlot(undefined);
            await lineup.refetch();
            setError(t('errors.event.lineupChanged'));
          } else {
            // The lineup on screen stays, and the next change sends all of it again.
            setError(t(errorMessageKey(err, 'errors.event.lineupSaveFailed')));
          }
          return;
        }
      }
      setStatus('saved');
    } finally {
      saving.current = false;
    }
  };

  /**
   * Shows a new lineup and saves it.
   *
   * @param next - The whole lineup.
   * @param wait - Waits this long for another change first, for typing.
   */
  const change = (next: LineupSlot[], wait = 0): void => {
    setSlots(next);
    setError(undefined);
    setNotice(undefined);
    clearTimeout(typing.current);
    typing.current = undefined;
    // A position still being typed is saved once it is one the server takes,
    // and an earlier version of it waiting to go out is dropped.
    if (!next.every((slot) => isPosition(slot.position))) {
      pending.current = undefined;
      return;
    }
    pending.current = next;
    if (wait === 0) {
      void flush();
      return;
    }
    typing.current = setTimeout(() => {
      typing.current = undefined;
      void flush();
    }, wait);
  };

  const copyPrevious = async (): Promise<void> => {
    setError(undefined);
    const previous = await api.getLineup(teamId, {
      eventId: item.eventId,
      occurrenceStartsAt: item.startsAt,
      source: 'previous',
    });
    if (previous.slots.length === 0 || previous.occurrenceStartsAt === item.startsAt) {
      setNotice(t('schedule.noPreviousLineup'));
      return;
    }
    change(previous.slots);
    setNotice(t('schedule.lineupCopied'));
  };

  const choicesFor = (slot: LineupSlot): string[] =>
    positionChoices(
      roster.find((member) => member.userId === slot.userId)?.positions,
      shownSlots.filter((row) => row.userId !== slot.userId).map((row) => row.position),
    );

  const toggleSlot = (slot: LineupSlot): void => {
    if (openSlot === slot.userId) {
      setOpenSlot(undefined);
      return;
    }
    setOpenSlot(slot.userId);
    // A position no chip offers was typed, so open with the field showing it.
    const typed = slot.position.trim() !== '' && !choicesFor(slot).some((choice) => samePosition(choice, slot.position));
    setCustom(typed);
  };

  const setPosition = (userId: string, position: string, wait = 0): void => {
    change(
      shownSlots.map((row) => (row.userId === userId ? { ...row, position } : row)),
      wait,
    );
  };

  const available = roster.filter((member) => !shownSlots.some((slot) => slot.userId === member.userId));

  return (
    <View className="mt-2">
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="font-semibold text-ink">{t('schedule.lineup')}</Text>
        {status !== undefined ? (
          <Text className="text-sm text-muted">
            {status === 'saving' ? t('schedule.lineupSaving') : t('schedule.lineupSaved')}
          </Text>
        ) : null}
      </View>
      <ErrorText message={shown} />
      {notice !== undefined ? <Text className="mb-2 text-muted">{notice}</Text> : null}
      {shownSlots.length === 0 ? <Text className="mb-2 text-muted">{t('schedule.lineupEmpty')}</Text> : null}
      <View>
        {shownSlots.map((slot, index) => {
          const name = nameOf(slot.userId);
          if (!canManage) {
            return (
              <View key={slot.userId} style={{ marginBottom: ROW_GAP }}>
                <SlotName name={name} position={slot.position} />
              </View>
            );
          }
          const open = openSlot === slot.userId;
          return (
            <DraggableRow
              key={slot.userId}
              label={t('schedule.reorder', { name })}
              moveUpLabel={t('schedule.moveUp')}
              moveDownLabel={t('schedule.moveDown')}
              offset={dragOffset}
              shift={drag !== undefined ? shiftFor(index, drag.from, drag.to, dragStep) : 0}
              dragging={drag?.from === index}
              onLayout={(layout) => {
                rows.current[index] = layout;
              }}
              onStart={() => startDrag(index)}
              onMove={(dy) => moveDrag(index, dy)}
              onEnd={(dy) => endDrag(index, dy)}
              onStep={(direction) => {
                const moved = moveSlot(shownSlots, index, index + direction);
                if (moved.some((row, at) => row !== shownSlots[at])) change(moved);
              }}
              header={
                <>
                  <Pressable
                    className="flex-1"
                    accessibilityRole="button"
                    accessibilityLabel={t('schedule.choosePosition', { name })}
                    accessibilityState={{ expanded: open }}
                    onPress={() => toggleSlot(slot)}
                  >
                    <SlotName name={name} position={slot.position} placeholder={t('schedule.addPosition')} editable />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('schedule.removeFromLineup', { name })}
                    className="p-1.5"
                    hitSlop={8}
                    onPress={() => {
                      change(shownSlots.filter((row) => row.userId !== slot.userId));
                      if (open) setOpenSlot(undefined);
                    }}
                  >
                    <X size={18} color={colors.muted} strokeWidth={2} />
                  </Pressable>
                </>
              }
            >
              {open ? (
                // Lines up with the name, past the grip.
                <View className="ml-9 mt-1">
                  <View className="flex-row flex-wrap">
                    {choicesFor(slot).map((position) => (
                      <Chip
                        key={position}
                        label={position}
                        selected={!custom && samePosition(position, slot.position)}
                        onPress={() => {
                          setPosition(slot.userId, position);
                          setOpenSlot(undefined);
                        }}
                      />
                    ))}
                    <Chip label={t('schedule.otherPosition')} selected={custom} onPress={() => setCustom(true)} />
                  </View>
                  {custom ? (
                    <>
                      <Field
                        label={t('schedule.position')}
                        hideLabel
                        placeholder={t('schedule.position')}
                        value={slot.position}
                        onChangeText={(position) => setPosition(slot.userId, position, TYPING_SAVE_MS)}
                      />
                      {slot.position.trim() !== '' && !isPosition(slot.position) ? (
                        <Text className="-mt-2 mb-3 text-sm text-danger">{t('errors.position.invalid')}</Text>
                      ) : null}
                    </>
                  ) : null}
                </View>
              ) : null}
            </DraggableRow>
          );
        })}
      </View>
      {canManage && adding ? (
        <View className="mb-3">
          {available.map((member) => (
            <Pressable
              key={member.userId}
              className="mb-2"
              onPress={() => {
                change([...shownSlots, { userId: member.userId, position: member.positions?.[0] ?? 'Player' }]);
                setAdding(false);
              }}
            >
              <Text className="text-link">{nameOf(member.userId)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {canManage ? (
        <View>
          <Button label={t('schedule.addToLineup')} tone="secondary" onPress={() => setAdding(true)} />
          <Button label={t('schedule.copyPrevious')} tone="secondary" onPress={() => void copyPrevious().catch(() => setError(t('errors.event.lineupCopyFailed')))} />
        </View>
      ) : null}
    </View>
  );
};

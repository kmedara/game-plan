/**
 * Game lineup for one occurrence.
 *
 * Managers reorder players by dragging the grip beside each name. Screen
 * readers get move up and move down actions on the same grip.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import GripVertical from 'lucide-react-native/icons/grip-vertical';
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
import type { LineupSlot, ScheduleOccurrence, TeamMember } from '@gameplan/types';
import { errorCode, queryError } from '@/src/errors';
import { noPull } from '@/src/pull-refresh';
import { lineupMutation, lineupQuery } from '@/src/queries/schedule';
import { useApp } from '@/src/state';
import { colors } from '@/src/theme';
import { Button, ErrorText, Field, SubmitButton } from '@/src/ui';

/** Space between lineup rows, which a dragged row also covers when it passes one. */
const ROW_GAP = 12;

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
  const dragOffset = useRef(new Animated.Value(0)).current;
  const rows = useRef<LayoutRectangle[]>([]);
  const dragStep = drag !== undefined ? (rows.current[drag.from]?.height ?? 0) + ROW_GAP : 0;

  useEffect(() => {
    setSlots(undefined);
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
    setSlots(moveSlot(shownSlots, from, dropIndex(rows.current, from, dy)));
    dragOffset.setValue(0);
    setDrag(undefined);
  };

  const save = async (): Promise<boolean | void> => {
    setError(undefined);
    try {
      const saved = await saveLineup.mutateAsync({
        teamId,
        body: {
          eventId: item.eventId,
          occurrenceStartsAt: item.startsAt,
          slots: shownSlots,
          ...(lineup.data?.version !== undefined ? { version: lineup.data.version } : {}),
        },
      });
      setSlots(saved.slots);
      setNotice(t('schedule.lineupSaved'));
    } catch (err) {
      if (errorCode(err) !== 'lineup_changed') throw err;
      // Someone else saved first. Show their lineup rather than overwrite it.
      setSlots(undefined);
      await lineup.refetch();
      setNotice(undefined);
      setError(t('errors.event.lineupChanged'));
      return false;
    }
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
    setSlots(previous.slots);
    setNotice(t('schedule.lineupCopied'));
  };

  const available = roster.filter((member) => !shownSlots.some((slot) => slot.userId === member.userId));

  return (
    <View className="mt-2">
      <Text className="mb-2 font-semibold text-ink">{t('schedule.lineup')}</Text>
      <ErrorText message={shown} />
      {notice !== undefined ? <Text className="mb-2 text-muted">{notice}</Text> : null}
      {shownSlots.length === 0 ? <Text className="mb-2 text-muted">{t('schedule.lineupEmpty')}</Text> : null}
      <View>
        {shownSlots.map((slot, index) =>
          canManage ? (
            <DraggableRow
              key={slot.userId}
              label={t('schedule.reorder', { name: nameOf(slot.userId) })}
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
              onStep={(direction) => setSlots(moveSlot(shownSlots, index, index + direction))}
              header={<Text className="flex-1 text-ink">{nameOf(slot.userId)}</Text>}
            >
              <Field
                label={t('schedule.position')}
                value={slot.position}
                onChangeText={(position) => {
                  setSlots(shownSlots.map((row) => (row.userId === slot.userId ? { ...row, position } : row)));
                }}
              />
              <Button
                label={t('schedule.removeFromLineup')}
                tone="secondary"
                onPress={() => setSlots(shownSlots.filter((row) => row.userId !== slot.userId))}
              />
            </DraggableRow>
          ) : (
            <View key={slot.userId} style={{ marginBottom: ROW_GAP }}>
              <Text className="mb-1 text-ink">{nameOf(slot.userId)}</Text>
              <Text className="text-muted">{slot.position}</Text>
            </View>
          ),
        )}
      </View>
      {canManage && adding ? (
        <View className="mb-3">
          {available.map((member) => (
            <Pressable
              key={member.userId}
              className="mb-2"
              onPress={() => {
                setSlots([...shownSlots, { userId: member.userId, position: member.positions?.[0] ?? 'Player' }]);
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
          <SubmitButton label={t('schedule.saveLineup')} onPress={save} />
        </View>
      ) : null}
    </View>
  );
};

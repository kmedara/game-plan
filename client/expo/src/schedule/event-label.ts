/**
 * The name an event shows in the app.
 */

import type { TFunction } from 'i18next';
import type { EventType, GameSide } from '@gameplan/types';

/**
 * Practices read "Practice" and games read their side against the opponent.
 * Meetings and other events show their own title.
 *
 * @param t - The translator.
 * @param event - The event type, title, and game fields.
 * @returns Translated text.
 */
export const eventLabel = (
  t: TFunction,
  event: { eventType: EventType; title: string; opponentName?: string; side?: GameSide },
): string => {
  if (event.eventType === 'practice') return t('eventType.practice');
  if (event.eventType !== 'game') return event.title;
  const side = event.side === undefined ? t('eventType.game') : t(`schedule.${event.side}`);
  return event.opponentName === undefined
    ? side
    : t('schedule.gameVs', { side, opponent: event.opponentName });
};

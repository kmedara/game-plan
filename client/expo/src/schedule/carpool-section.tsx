/**
 * Offers and claims for one occurrence.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ScheduleOccurrence } from '@gameplan/types';
import { errorMessageKey, queryError } from '@/src/errors';
import { carpoolClaimMutation, carpoolOfferMutation, carpoolQuery } from '@/src/queries/schedule';
import { useApp } from '@/src/state';
import { colors } from '@/src/theme';
import { ErrorText } from '@/src/ui';

export const CarpoolSection = ({
  item,
  teamId,
  userId,
  nameOf,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  userId: string | undefined;
  nameOf: (id: string) => string;
}) => {
  const { t } = useTranslation();
  const { api, brand } = useApp();
  const queryClient = useQueryClient();
  const carpool = useQuery(carpoolQuery(api, teamId, item.eventId, item.startsAt));
  const offerSeats = useMutation(carpoolOfferMutation(api, queryClient));
  const claimRide = useMutation(carpoolClaimMutation(api, queryClient));
  const offers = carpool.data ?? [];
  const [error, setError] = useState<string | undefined>();
  const mine = offers.find((offer) => offer.userId === userId);
  const shown = error ?? (queryError(carpool.error) !== undefined ? t('errors.event.carpoolLoadFailed') : undefined);

  const saveSeats = (seats: number): void => {
    setError(undefined);
    void offerSeats
      .mutateAsync({
        teamId,
        body: { eventId: item.eventId, occurrenceStartsAt: item.startsAt, seats },
      })
      .catch((err: unknown) => setError(t(errorMessageKey(err, 'errors.event.carpoolSaveFailed'))));
  };

  const claim = (driverUserId: string): void => {
    setError(undefined);
    void claimRide
      .mutateAsync({
        teamId,
        body: {
          eventId: item.eventId,
          occurrenceStartsAt: item.startsAt,
          driverUserId,
        },
      })
      .catch((err: unknown) =>
        setError(
          t(
            errorMessageKey(err, 'errors.event.carpoolSaveFailed', {
              carpool_full: 'schedule.carpoolFull',
              carpool_own_offer: 'schedule.carpoolOwn',
            }),
          ),
        ),
      );
  };

  return (
    <View className="mt-2">
      <Text className="mb-1 font-semibold text-ink">{t('schedule.carpool')}</Text>
      {offers.length === 0 ? <Text className="mb-2 text-muted">{t('schedule.carpoolEmpty')}</Text> : null}
      {offers.map((offer) => {
        const riding = userId !== undefined && offer.riderIds.includes(userId);
        const full = offer.riderIds.length >= offer.seats;
        return (
          <View key={offer.userId} className="mb-3">
            <Text className="text-ink">{nameOf(offer.userId)}</Text>
            <Text className="text-muted">
              {t('schedule.seatsTaken', { taken: offer.riderIds.length, seats: offer.seats })}
            </Text>
            {offer.riderIds.length > 0 ? (
              <Text className="text-ink">
                {t('schedule.riders')}: {offer.riderIds.map((id) => nameOf(id)).join(', ')}
              </Text>
            ) : null}
            {offer.userId !== userId ? (
              <Pressable
                accessibilityRole="button"
                disabled={!riding && full}
                className="mt-1 self-start rounded-full border border-line bg-inset px-3 py-1.5"
                style={{ opacity: !riding && full ? 0.4 : 1 }}
                onPress={() => claim(offer.userId)}
              >
                <Text className="text-ink">{riding ? t('schedule.leaveRide') : t('schedule.claimRide')}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Text className="mb-1 text-muted">{t('schedule.offerSeats')}</Text>
      <View className="mb-2 flex-row flex-wrap">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((seats) => {
          const selected = mine?.seats === seats;
          return (
            <Pressable
              key={seats}
              accessibilityRole="button"
              className="mb-2 mr-2 h-10 w-10 items-center justify-center rounded-full border"
              style={{
                borderColor: selected ? brand.primary : colors.line,
                backgroundColor: selected ? brand.primary : colors.paper,
              }}
              onPress={() => saveSeats(seats)}
            >
              <Text style={{ color: selected ? brand.onPrimary : colors.ink }}>{seats}</Text>
            </Pressable>
          );
        })}
      </View>
      {mine !== undefined ? (
        <Pressable accessibilityRole="button" className="mb-2 self-start" onPress={() => saveSeats(0)}>
          <Text className="text-link">{t('schedule.clearOffer')}</Text>
        </Pressable>
      ) : null}
      <ErrorText message={shown} />
    </View>
  );
};

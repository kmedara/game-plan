/**
 * Occurrence sheet: time, place, RSVP, attendance, carpool, and lineup.
 */

import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rolesFromMembership } from '@gameplan/rules';
import { RSVP_STATUSES, type Fixture, type RsvpStatus, type ScheduleOccurrence } from '@gameplan/types';
import { GameFixture } from '@/src/fixture-panel';
import { appLocale } from '@/src/i18n';
import { MapPicker } from '@/src/map-picker';
import { mapsUrl, type MapsProvider } from '@/src/maps';
import { membersQuery } from '@/src/queries/teams';
import { clockLabel } from '@/src/schedule-calendar';
import { useApp } from '@/src/state';
import { timeZoneLabel } from '@/src/time-zones';
import { ErrorText } from '@/src/ui';
import { AttendanceRow } from './attendance-row';
import { CarpoolSection } from './carpool-section';
import { LineupEditor } from './lineup-editor';
import { RsvpChoices, rsvpLabelKey, useHour12 } from './rsvp';

export const EventDetail = ({
  item,
  teamId,
  zone,
  teamName,
  userId,
  maps,
  canManage,
  canShare,
  fixture,
  onRsvp,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  zone: string;
  teamName: string | undefined;
  userId: string | undefined;
  maps: MapsProvider;
  canManage: boolean;
  canShare: boolean;
  fixture: Fixture | undefined;
  onRsvp: (status: RsvpStatus) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [error, setError] = useState<string | undefined>();
  const roster = useQuery(membersQuery(api, teamId)).data ?? [];
  const byId = new Map(roster.map((member) => [member.userId, member]));
  const hour12 = useHour12();
  const mine = item.rsvps.find((rsvp) => rsvp.userId === userId)?.status;
  const rsvpByUser = new Map(item.rsvps.map((rsvp) => [rsvp.userId, rsvp.status]));
  const noReply = roster.filter((member) => !rsvpByUser.has(member.userId));
  const short = roster.filter(
    (member) => rolesFromMembership(member).includes('player') && rsvpByUser.get(member.userId) !== 'going',
  ).length;
  const nameOf = (id: string): string => byId.get(id)?.displayName ?? t('common.unknownPerson');
  const openMaps = (): void => {
    if (item.location === undefined && item.latitude === undefined) return;
    const url = mapsUrl(
      { label: item.location ?? 'Event', latitude: item.latitude, longitude: item.longitude },
      maps,
    );
    void WebBrowser.openBrowserAsync(url);
  };
  return (
    <View>
      {teamName !== undefined ? <Text className="mb-1 font-semibold text-ink">{teamName}</Text> : null}
      <Text className="text-muted">
        {t(`eventType.${item.eventType}`)} · {clockLabel(item.startsAt, zone, appLocale, hour12)}
      </Text>
      <Text className="text-muted">{timeZoneLabel(zone, new Date(item.startsAt))}</Text>
      {item.location !== undefined ? (
        <Pressable className="mt-2" onPress={openMaps}>
          <Text className="text-link">{item.location}</Text>
        </Pressable>
      ) : (
        <Text className="mt-2 text-muted">{t('schedule.noLocation')}</Text>
      )}
      {item.notes !== undefined && item.notes.length > 0 ? (
        <View className="mt-3">
          <Text className="mb-1 font-semibold text-ink">{t('schedule.notes')}</Text>
          <Text className="text-ink">{item.notes}</Text>
        </View>
      ) : null}
      <GameFixture item={item} teamId={teamId} canShare={canShare} fixture={fixture} />
      {item.latitude !== undefined && item.longitude !== undefined ? (
        <View className="mt-3">
          <MapPicker latitude={item.latitude} longitude={item.longitude} readOnly />
        </View>
      ) : null}
      <Text className="mt-4 font-semibold text-ink">{t('schedule.yourRsvp')}</Text>
      <RsvpChoices mine={mine} onRsvp={onRsvp} />
      <Text className="mb-1 mt-4 font-semibold text-ink">{t('schedule.attendance')}</Text>
      <Text className="mb-2 text-muted">{t('schedule.short', { count: short })}</Text>
      <ErrorText message={error} />
      {RSVP_STATUSES.map((status) => {
        const rows = item.rsvps.filter((rsvp) => rsvp.status === status);
        return (
          <View key={status} className="mb-3">
            <Text className="mb-1 text-muted">
              {t(rsvpLabelKey(status))} · {rows.length}
            </Text>
            {rows.map((rsvp) => (
              <AttendanceRow
                key={rsvp.userId}
                userId={rsvp.userId}
                name={nameOf(rsvp.userId)}
                member={byId.get(rsvp.userId)}
                self={rsvp.userId === userId}
                onError={setError}
              />
            ))}
          </View>
        );
      })}
      <View className="mb-3">
        <Text className="mb-1 text-muted">{t('schedule.noReply')} · {noReply.length}</Text>
        {noReply.map((member) => (
          <AttendanceRow
            key={member.userId}
            userId={member.userId}
            name={nameOf(member.userId)}
            member={member}
            self={member.userId === userId}
            onError={setError}
          />
        ))}
      </View>
      <CarpoolSection
        item={item}
        teamId={teamId}
        userId={userId}
        nameOf={nameOf}
      />
      {item.eventType === 'game' ? (
        <LineupEditor item={item} teamId={teamId} roster={roster} canManage={canManage} nameOf={nameOf} />
      ) : null}
    </View>
  );
};

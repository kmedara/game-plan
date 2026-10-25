/**
 * One person on the attendance list, with call, text, or a private chat.
 */

import { Text, View } from 'react-native';
import type { TeamMember } from '@gameplan/types';
import { ContactButtons } from '@/src/contact-buttons';
import { useDownloadUrl } from '@/src/media';
import { ProfilePhoto } from '@/src/ui';

export const AttendanceRow = ({
  userId,
  name,
  member,
  self,
  onError,
}: {
  userId: string;
  name: string;
  member: TeamMember | undefined;
  self: boolean;
  onError: (message: string) => void;
}) => {
  const photo = useDownloadUrl(member?.photoKey, { userId });
  return (
    <View className="mb-2 flex-row items-center">
      <ProfilePhoto name={name} uri={photo} size={36} />
      <Text className="ml-3 flex-1 text-base text-ink">{name}</Text>
      {!self ? <ContactButtons userId={userId} phone={member?.phoneNumber} onError={onError} /> : null}
    </View>
  );
};

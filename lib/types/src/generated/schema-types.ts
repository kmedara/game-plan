/**
 * AUTO-GENERATED FILE — do not edit.
 *
 * Source: `@gameplan/schemas`
 * Generate: `npm run generate:types`
 */

export type AcceptedInvite = {
  teamId: string;
  name: string;
  timeZone: string;
  defaultChatId: string;
  role: 'team_admin' | 'coach' | 'player' | 'parent';
  joinedAt: string;
}

export type AcceptFixtureBody = {
  eventId?: string;
  startsAt?: string;
  endsAt?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type AccountKind = 'adult' | 'minor';

export type ApprovedJoinRequest = {
  teamId: string;
  userId: string;
  role: 'team_admin' | 'coach' | 'player' | 'parent';
  joinedAt: string;
  defaultChatId: string;
}

export type ApproveJoinRequestBody = {
  role: 'team_admin' | 'coach' | 'player' | 'parent';
}

export type AssignRoleBody = {
  /**
   * @minItems 1
   */
  roles: ['team_admin' | 'coach' | 'player' | 'parent', ...('team_admin' | 'coach' | 'player' | 'parent')[]];
}

export type AuthUser = {
  userId: string;
  email?: string;
}

export type CarpoolClaimBody = {
  eventId: string;
  occurrenceStartsAt: string;
  driverUserId: string;
}

export type CarpoolOfferBody = {
  eventId: string;
  occurrenceStartsAt: string;
  seats: number;
}

export type CarpoolOffer = {
  userId: string;
  seats: number;
  riderIds: string[];
}

export type CarpoolQuery = {
  eventId: string;
  occurrenceStartsAt: string;
}

export type CarpoolResponse = {
  eventId: string;
  occurrenceStartsAt: string;
  offers: {
    userId: string;
    seats: number;
    riderIds: string[];
  }[];
}

export type ChatKind = 'default' | 'channel' | 'private' | 'fixture';

export type ChatList = {
  chats: {
    chatId: string;
    kind: 'default' | 'channel' | 'private' | 'fixture';
    name: string;
    teamId?: string;
    createdBy: string;
    createdAt: string;
  }[];
}

export type ChatMessage = {
  messageId: string;
  chatId: string;
  senderId: string;
  senderDisplayName: string;
  senderPhotoKey?: string;
  body: string;
  attachmentKeys?: string[];
  createdAt: string;
}

export type ChatParticipant = {
  userId: string;
  accountKind: 'adult' | 'minor';
  teamIds: string[];
  guardianIds?: string[];
}

export type ChatSummary = {
  chatId: string;
  kind: 'default' | 'channel' | 'private' | 'fixture';
  name: string;
  teamId?: string;
  createdBy: string;
  createdAt: string;
}

export type CompleteProfileBody = {
  birthday: string;
  displayName?: string;
}

export type ConfirmationRequired = {
  confirmationRequired: true;
  email: string;
}

export type ConfirmRegistrationBody = {
  email: string;
  code: string;
}

export type CreateEventBody = {
  eventType: 'practice' | 'game' | 'meeting' | 'other';
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval?: number;
    until?: string;
    count?: number;
    byWeekDay?: string[];
  };
  opponentName?: string;
  side?: 'home' | 'away';
}

export type CreateGuardianInviteBody = {
  email: string;
}

export type CreateInviteBody = {
  role?: 'team_admin' | 'coach' | 'player' | 'parent';
}

export type CreatePrivateChatBody = {
  /**
   * @minItems 1
   */
  memberIds: [string, ...string[]];
  name?: string;
}

export type CreateTeamBody = {
  name: string;
  timeZone: string;
  sport?: string;
}

export type CreateTeamChannelBody = {
  teamId: string;
  name: string;
}

export type DevicePlatform = 'ios' | 'android' | 'web';

export type DeviceRegistration = {
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  updatedAt: string;
}

export type DisplayName = string;

export type ErrorBody = {
  error: string;
}

export type EventResponse = {
  eventId: string;
  teamId: string;
  eventType: 'practice' | 'game' | 'meeting' | 'other';
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval?: number;
    until?: string;
    count?: number;
    byWeekDay?: string[];
  };
  seriesEventId?: string;
  originalStartsAt?: string;
  exdates?: string[];
  opponentName?: string;
  side?: 'home' | 'away';
  fixtureId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type EventType = 'practice' | 'game' | 'meeting' | 'other';

export type ExceptionEventBody = {
  occurrenceStartsAt: string;
  eventType?: 'practice' | 'game' | 'meeting' | 'other';
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  location?: string | null;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval?: number;
    until?: string;
    count?: number;
    byWeekDay?: string[];
  } | null;
  opponentName?: string | null;
  side?: ('home' | 'away') | null;
}

export type FanoutJob =
  | {
      type: 'schedule_changed';
      teamId: string;
      eventId: string;
      /**
       * @minItems 1
       */
      userIds?: [string, ...string[]];
      attempt?: number;
    }
  | {
      type: 'event_moved';
      teamId: string;
      eventId: string;
      title: string;
      occurrenceStartsAt?: string;
      change: 'time' | 'location' | 'both';
      /**
       * @minItems 1
       */
      userIds?: [string, ...string[]];
      attempt?: number;
    }
  | {
      type: 'event_reminder';
      teamId: string;
      eventId: string;
      title: string;
      occurrenceStartsAt: string;
      location?: string;
      kind: 'evening' | 'hour';
      /**
       * @minItems 1
       */
      userIds: [string, ...string[]];
      attempt?: number;
    }
  | {
      type: 'chat_message';
      chatId: string;
      messageId: string;
      senderId: string;
      senderDisplayName?: string;
      senderPhotoKey?: string;
      body: string;
      createdAt: string;
      attachmentKeys?: string[];
      /**
       * @minItems 1
       */
      userIds?: [string, ...string[]];
      attempt?: number;
    }
  | {
      type: 'join_requested';
      teamId: string;
      requestId: string;
      teamName: string;
      requesterDisplayName: string;
      /**
       * @minItems 1
       */
      userIds?: [string, ...string[]];
      attempt?: number;
    };

export type FixtureList = {
  teamId: string;
  fixtures: {
    fixtureId: string;
    status: 'proposed' | 'linked';
    startsAt: string;
    endsAt?: string;
    location?: string;
    latitude?: number;
    longitude?: number;
    homeName: string;
    awayName: string;
    homeTeamId?: string;
    awayTeamId?: string;
    homeEventId?: string;
    awayEventId?: string;
    proposerTeamId: string;
    inviteeTeamId: string;
    sport?: string;
    chatId?: string;
    createdAt: string;
    updatedAt: string;
  }[];
}

export type Fixture = {
  fixtureId: string;
  status: 'proposed' | 'linked';
  startsAt: string;
  endsAt?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  homeName: string;
  awayName: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeEventId?: string;
  awayEventId?: string;
  proposerTeamId: string;
  inviteeTeamId: string;
  sport?: string;
  chatId?: string;
  createdAt: string;
  updatedAt: string;
}

export type FixtureStatus = 'proposed' | 'linked';

export type GameSide = 'home' | 'away';

export type GuardianLink = {
  inviteId?: string;
  minorId: string;
  adultId: string;
  email?: string;
}

export type InvitePreview = {
  code: string;
  teamId: string;
  teamName: string;
  role: 'team_admin' | 'coach' | 'player' | 'parent';
  createdAt: string;
  expiresAt: string;
}

export type JoinRequestCreated = {
  requestId: string;
  teamId: string;
  userId: string;
  createdAt: string;
}

export type JoinRequestList = {
  joinRequests: {
    requestId: string;
    userId: string;
    createdAt: string;
    displayName?: string;
    email?: string;
    accountKind?: 'adult' | 'minor';
  }[];
}

export type JoinRequest = {
  requestId: string;
  userId: string;
  createdAt: string;
  displayName?: string;
  email?: string;
  accountKind?: 'adult' | 'minor';
}

export type LineupBody = {
  eventId: string;
  occurrenceStartsAt: string;
  /**
   * @maxItems 30
   */
  slots: {
    userId: string;
    position: string;
  }[];
}

export type LineupQuery = {
  eventId: string;
  occurrenceStartsAt: string;
  source?: 'current' | 'previous';
}

export type LineupResponse = {
  eventId: string;
  occurrenceStartsAt: string;
  slots: {
    userId: string;
    position: string;
  }[];
}

export type LineupSlot = {
  userId: string;
  position: string;
}

export type LoginBody = {
  email: string;
  password: string;
}

export type MessageHistoryQuery = {
  limit?: number;
  cursor?: string;
}

export type MessagePage = {
  messages: {
    messageId: string;
    chatId: string;
    senderId: string;
    senderDisplayName: string;
    senderPhotoKey?: string;
    body: string;
    attachmentKeys?: string[];
    createdAt: string;
  }[];
  cursor?: string;
}

export type OauthExchangeBody = {
  code: string;
}

export type OauthExchangeResponse = {
  accessToken: string;
  expiresIn: number;
  user: {
    userId: string;
    email: string;
    displayName: string;
    accountKind: 'adult' | 'minor';
    birthday?: string;
    photoKey?: string;
    phoneNumber?: string;
    needsProfileCompletion?: boolean;
  };
  refreshToken: string;
  next: 'teams' | 'complete-profile';
}

export type OauthNext = 'teams' | 'complete-profile';

export type OccurrenceTarget = {
  occurrenceStartsAt: string;
}

export type PhoneNumber = string;

export type PlaceDetails = {
  label: string;
  latitude: number;
  longitude: number;
}

export type PlacesAutocompleteQuery = {
  q: string;
}

export type PlacesAutocompleteResponse = {
  suggestions: {
    id: string;
    primaryText: string;
    secondaryText?: string;
  }[];
}

export type PlacesMapQuery = {
  latitude: number;
  longitude: number;
}

export type PlacesResolveQuery = {
  id: string;
}

export type PlacesReverseQuery = {
  latitude: number;
  longitude: number;
}

export type PlaceSuggestion = {
  id: string;
  primaryText: string;
  secondaryText?: string;
}

export type PresignDownloadQuery = {
  objectKey: string;
  chatId?: string;
  userId?: string;
  teamId?: string;
}

export type PresignDownloadResponse = {
  downloadUrl: string;
  objectKey: string;
  expiresAt: string;
}

export type PresignUploadBody = {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif';
  contentLength: number;
}

export type PresignUploadResponse = {
  uploadUrl: string;
  objectKey: string;
  maxBytes: 15728640;
}

export type ProposeFixtureBody = {
  teamId: string;
}

export type RecurrenceRule = {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval?: number;
  until?: string;
  count?: number;
  byWeekDay?: string[];
}

export type RefreshBody = {
  refreshToken?: string;
}

export type RegisterBody = {
  email: string;
  password: string;
  displayName: string;
  birthday: string;
}

export type RegisterDeviceBody = {
  token: string;
  platform: 'ios' | 'android' | 'web';
}

export type ResendConfirmationBody = {
  email: string;
}

export type RolePermissionsResponse = {
  roles: {
    role: 'team_admin' | 'coach' | 'player' | 'parent';
    permissions: (
      | 'manage_permissions'
      | 'manage_team_settings'
      | 'invite_members'
      | 'approve_join_requests'
      | 'assign_roles'
      | 'manage_events'
      | 'create_team_channels'
    )[];
  }[];
}

export type RolePermissions = {
  role: 'team_admin' | 'coach' | 'player' | 'parent';
  permissions: (
    | 'manage_permissions'
    | 'manage_team_settings'
    | 'invite_members'
    | 'approve_join_requests'
    | 'assign_roles'
    | 'manage_events'
    | 'create_team_channels'
  )[];
}

export type RsvpBody = {
  eventId: string;
  occurrenceStartsAt: string;
  status: 'going' | 'not_going' | 'maybe';
}

export type RsvpResponse = {
  eventId: string;
  occurrenceStartsAt: string;
  userId: string;
  status: 'going' | 'not_going' | 'maybe';
  updatedAt: string;
}

export type RsvpStatus = 'going' | 'not_going' | 'maybe';

export type ScheduleList = {
  teamId: string;
  from: string;
  to: string;
  occurrences: {
    eventId: string;
    eventType: 'practice' | 'game' | 'meeting' | 'other';
    title: string;
    startsAt: string;
    endsAt?: string;
    location?: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
    recurring: boolean;
    seriesEventId?: string;
    originalStartsAt?: string;
    opponentName?: string;
    side?: 'home' | 'away';
    fixtureId?: string;
    rsvps: {
      userId: string;
      status: 'going' | 'not_going' | 'maybe';
    }[];
  }[];
}

export type ScheduleOccurrence = {
  eventId: string;
  eventType: 'practice' | 'game' | 'meeting' | 'other';
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  recurring: boolean;
  seriesEventId?: string;
  originalStartsAt?: string;
  opponentName?: string;
  side?: 'home' | 'away';
  fixtureId?: string;
  rsvps: {
    userId: string;
    status: 'going' | 'not_going' | 'maybe';
  }[];
}

export type ScheduleWindowQuery = {
  from: string;
  to: string;
}

export type SearchTeamDirectoryQuery = {
  q?: string;
  limit?: number;
  cursor?: string;
}

export type SearchUsersQuery = {
  email: string;
}

export type SendMessageBody = {
  body: string;
  /**
   * @maxItems 10
   */
  attachmentKeys?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
}

export type SessionTokens = {
  accessToken: string;
  expiresIn: number;
  user: {
    userId: string;
    email: string;
    displayName: string;
    accountKind: 'adult' | 'minor';
    birthday?: string;
    photoKey?: string;
    phoneNumber?: string;
    needsProfileCompletion?: boolean;
  };
  refreshToken?: string;
}

export type SocketTicket = {
  ticket: string;
  expiresIn: number;
}

export type Sport = string;

export type TeamDirectoryHit = {
  teamId: string;
  name: string;
  timeZone: string;
  location?: string;
}

export type TeamDirectoryPage = {
  teams: {
    teamId: string;
    name: string;
    timeZone: string;
    location?: string;
  }[];
  cursor?: string;
}

export type TeamInviteList = {
  invites: {
    code: string;
    teamId: string;
    role: 'team_admin' | 'coach' | 'player' | 'parent';
    createdBy?: string;
    createdAt: string;
    expiresAt: string;
  }[];
}

export type TeamInvite = {
  code: string;
  teamId: string;
  role: 'team_admin' | 'coach' | 'player' | 'parent';
  createdBy?: string;
  createdAt: string;
  expiresAt: string;
}

export type TeamList = {
  teams: {
    teamId: string;
    name: string;
    timeZone: string;
    location?: string;
    sport?: string;
    theme?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      logoKey?: string;
      chatBackgroundKey?: string;
      chatBackgroundOverlay?: 'dark' | 'light' | 'none';
    };
    role: 'team_admin' | 'coach' | 'player' | 'parent';
    /**
     * @minItems 1
     */
    roles: ['team_admin' | 'coach' | 'player' | 'parent', ...('team_admin' | 'coach' | 'player' | 'parent')[]];
    positions?: string[];
    defaultChatId?: string;
    createdAt?: string;
  }[];
}

export type TeamMemberList = {
  members: {
    userId: string;
    role: 'team_admin' | 'coach' | 'player' | 'parent';
    /**
     * @minItems 1
     */
    roles: ['team_admin' | 'coach' | 'player' | 'parent', ...('team_admin' | 'coach' | 'player' | 'parent')[]];
    joinedAt: string;
    displayName?: string;
    email?: string;
    accountKind?: 'adult' | 'minor';
    photoKey?: string;
    phoneNumber?: string;
    positions?: string[];
    hasGuardian?: boolean;
  }[];
}

export type TeamMemberProfile = {
  userId: string;
  role: 'team_admin' | 'coach' | 'player' | 'parent';
  /**
   * @minItems 1
   */
  roles: ['team_admin' | 'coach' | 'player' | 'parent', ...('team_admin' | 'coach' | 'player' | 'parent')[]];
  joinedAt: string;
  displayName?: string;
  email?: string;
  accountKind?: 'adult' | 'minor';
  photoKey?: string;
  phoneNumber?: string;
  positions?: string[];
  hasGuardian?: boolean;
  guardianIds?: string[];
}

export type TeamMember = {
  userId: string;
  role: 'team_admin' | 'coach' | 'player' | 'parent';
  /**
   * @minItems 1
   */
  roles: ['team_admin' | 'coach' | 'player' | 'parent', ...('team_admin' | 'coach' | 'player' | 'parent')[]];
  joinedAt: string;
  displayName?: string;
  email?: string;
  accountKind?: 'adult' | 'minor';
  photoKey?: string;
  phoneNumber?: string;
  positions?: string[];
  hasGuardian?: boolean;
}

export type TeamPermission =
  | 'manage_permissions'
  | 'manage_team_settings'
  | 'invite_members'
  | 'approve_join_requests'
  | 'assign_roles'
  | 'manage_events'
  | 'create_team_channels';

export type TeamRole = 'team_admin' | 'coach' | 'player' | 'parent';

export type TeamSummary = {
  teamId: string;
  name: string;
  timeZone: string;
  location?: string;
  sport?: string;
  theme?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    logoKey?: string;
    chatBackgroundKey?: string;
    chatBackgroundOverlay?: 'dark' | 'light' | 'none';
  };
  role: 'team_admin' | 'coach' | 'player' | 'parent';
  /**
   * @minItems 1
   */
  roles: ['team_admin' | 'coach' | 'player' | 'parent', ...('team_admin' | 'coach' | 'player' | 'parent')[]];
  positions?: string[];
  defaultChatId?: string;
  createdAt?: string;
}

export type TeamTheme = {
  primary?: string;
  secondary?: string;
  accent?: string;
  logoKey?: string;
  chatBackgroundKey?: string;
  chatBackgroundOverlay?: 'dark' | 'light' | 'none';
}

export type TimeZone = string;

export type UpdateEventBody = {
  eventType?: 'practice' | 'game' | 'meeting' | 'other';
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  location?: string | null;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval?: number;
    until?: string;
    count?: number;
    byWeekDay?: string[];
  } | null;
  opponentName?: string | null;
  side?: ('home' | 'away') | null;
}

export type UpdateFixtureBody = {
  startsAt?: string;
  endsAt?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type UpdatePositionsBody = {
  positions: string[];
}

export type UpdateProfileBody = {
  photoKey?: string | null;
  phoneNumber?: string | null;
}

export type UpdateRolePermissionsBody = {
  /**
   * @minItems 1
   */
  roles: [
    {
      role: 'team_admin' | 'coach' | 'player' | 'parent';
      permissions: (
        | 'manage_permissions'
        | 'manage_team_settings'
        | 'invite_members'
        | 'approve_join_requests'
        | 'assign_roles'
        | 'manage_events'
        | 'create_team_channels'
      )[];
    },
    ...{
      role: 'team_admin' | 'coach' | 'player' | 'parent';
      permissions: (
        | 'manage_permissions'
        | 'manage_team_settings'
        | 'invite_members'
        | 'approve_join_requests'
        | 'assign_roles'
        | 'manage_events'
        | 'create_team_channels'
      )[];
    }[]
  ];
}

export type UpdateTeamBody = {
  name?: string;
  timeZone?: string;
  location?: string | null;
  sport?: string | null;
  theme?: {
    primary?: string | null;
    secondary?: string | null;
    accent?: string | null;
    logoKey?: string | null;
    chatBackgroundKey?: string | null;
    chatBackgroundOverlay?: ('dark' | 'light' | 'none') | null;
  } | null;
}

export type UpdateTeamTheme = {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
  logoKey?: string | null;
  chatBackgroundKey?: string | null;
  chatBackgroundOverlay?: ('dark' | 'light' | 'none') | null;
}

export type UploadImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif';

export type UserProfile = {
  userId: string;
  email: string;
  displayName: string;
  accountKind: 'adult' | 'minor';
  birthday?: string;
  photoKey?: string;
  phoneNumber?: string;
  needsProfileCompletion?: boolean;
}

export type UserSearchPolicy = {
  adultsOnly: boolean;
}

export const ACCOUNT_KINDS = ["adult", "minor"] as const;

export const CHAT_KINDS = ["default", "channel", "private", "fixture"] as const;

export const DEVICE_PLATFORMS = ["ios", "android", "web"] as const;

export const EVENT_TYPES = ["practice", "game", "meeting", "other"] as const;

export const FIXTURE_STATUSES = ["proposed", "linked"] as const;

export const GAME_SIDES = ["home", "away"] as const;

export const RSVP_STATUSES = ["going", "not_going", "maybe"] as const;

export const TEAM_ROLES = ["team_admin", "coach", "player", "parent"] as const;

export const TEAM_PERMISSIONS = ["manage_permissions", "manage_team_settings", "invite_members", "approve_join_requests", "assign_roles", "manage_events", "create_team_channels"] as const;

export const DEFAULT_ROLE_PERMISSIONS = {
  team_admin: ["manage_permissions", "manage_team_settings", "invite_members", "approve_join_requests", "assign_roles", "manage_events", "create_team_channels"],
  coach: [],
  parent: [],
  player: [],
} as const;

export const MAX_UPLOAD_BYTES = 15728640;

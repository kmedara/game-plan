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
  role: 'team_admin' | 'coach' | 'parent' | 'player';
  joinedAt: string;
}

export type AccountKind = 'adult' | 'minor';

export type ApprovedJoinRequest = {
  teamId: string;
  userId: string;
  role: 'team_admin' | 'coach' | 'parent' | 'player';
  joinedAt: string;
  defaultChatId: string;
}

export type ApproveJoinRequestBody = {
  role: 'team_admin' | 'coach' | 'parent' | 'player';
}

export type AssignRoleBody = {
  role: 'team_admin' | 'coach' | 'parent' | 'player';
}

export type AuthUser = {
  userId: string;
  email?: string;
}

export type ChatKind = 'default' | 'channel' | 'private';

export type ChatList = {
  chats: {
    chatId: string;
    kind: 'default' | 'channel' | 'private';
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

export type ChatSummary = {
  chatId: string;
  kind: 'default' | 'channel' | 'private';
  name: string;
  teamId?: string;
  createdBy: string;
  createdAt: string;
}

export type CompleteProfileBody = {
  birthday: string;
  displayName?: string;
}

export type CreateEventBody = {
  eventType: 'practice' | 'game' | 'meeting' | 'fundraiser' | 'other';
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval?: number;
    until?: string;
    count?: number;
    byWeekDay?: string[];
  };
}

export type CreateInviteBody = {
  role?: 'team_admin' | 'coach' | 'parent' | 'player';
}

export type CreatePrivateChatBody = {
  /**
   * @minItems 1
   */
  memberIds: [string, ...string[]];
}

export type CreateTeamBody = {
  name: string;
  timeZone: string;
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

export type ErrorBody = {
  error: string;
}

export type EventResponse = {
  eventId: string;
  teamId: string;
  eventType: 'practice' | 'game' | 'meeting' | 'fundraiser' | 'other';
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval?: number;
    until?: string;
    count?: number;
    byWeekDay?: string[];
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type EventType = 'practice' | 'game' | 'meeting' | 'fundraiser' | 'other';

export type FanoutJob =
  | {
      type: 'schedule_changed';
      teamId: string;
      eventId: string;
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
    };

export type InvitePreview = {
  code: string;
  teamId: string;
  teamName: string;
  role: 'team_admin' | 'coach' | 'parent' | 'player';
  createdAt: string;
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

export type PresignDownloadQuery = {
  objectKey: string;
}

export type PresignDownloadResponse = {
  downloadUrl: string;
  objectKey: string;
}

export type PresignUploadBody = {
  contentType: string;
  contentLength: number;
}

export type PresignUploadResponse = {
  uploadUrl: string;
  objectKey: string;
  maxBytes: 15728640;
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

export type RolePermissionsResponse = {
  roles: {
    role: 'team_admin' | 'coach' | 'parent' | 'player';
    permissions: (
      | 'manage_permissions'
      | 'invite_members'
      | 'approve_join_requests'
      | 'assign_roles'
      | 'manage_events'
      | 'create_team_channels'
    )[];
  }[];
}

export type RolePermissions = {
  role: 'team_admin' | 'coach' | 'parent' | 'player';
  permissions: (
    | 'manage_permissions'
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
    eventType: 'practice' | 'game' | 'meeting' | 'fundraiser' | 'other';
    title: string;
    startsAt: string;
    endsAt?: string;
    location?: string;
    rsvps: {
      userId: string;
      status: ('going' | 'not_going' | 'maybe') | string;
    }[];
  }[];
}

export type ScheduleOccurrence = {
  eventId: string;
  eventType: 'practice' | 'game' | 'meeting' | 'fundraiser' | 'other';
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  rsvps: {
    userId: string;
    status: ('going' | 'not_going' | 'maybe') | string;
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
    needsProfileCompletion?: boolean;
  };
  refreshToken?: string;
}

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
    role: 'team_admin' | 'coach' | 'parent' | 'player';
    createdBy?: string;
    createdAt: string;
  }[];
}

export type TeamInvite = {
  code: string;
  teamId: string;
  role: 'team_admin' | 'coach' | 'parent' | 'player';
  createdBy?: string;
  createdAt: string;
}

export type TeamList = {
  teams: {
    teamId: string;
    name: string;
    timeZone: string;
    location?: string;
    theme?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      logoKey?: string;
    };
    role: ('team_admin' | 'coach' | 'parent' | 'player') | string;
    positions?: string[];
    defaultChatId?: string;
    createdAt?: string;
  }[];
}

export type TeamMemberList = {
  members: {
    userId: string;
    role: 'team_admin' | 'coach' | 'parent' | 'player';
    joinedAt: string;
    displayName?: string;
    email?: string;
    accountKind?: 'adult' | 'minor';
  }[];
}

export type TeamMember = {
  userId: string;
  role: 'team_admin' | 'coach' | 'parent' | 'player';
  joinedAt: string;
  displayName?: string;
  email?: string;
  accountKind?: 'adult' | 'minor';
}

export type TeamPermission =
  | 'manage_permissions'
  | 'invite_members'
  | 'approve_join_requests'
  | 'assign_roles'
  | 'manage_events'
  | 'create_team_channels';

export type TeamRole = 'team_admin' | 'coach' | 'parent' | 'player';

export type TeamSummary = {
  teamId: string;
  name: string;
  timeZone: string;
  location?: string;
  theme?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    logoKey?: string;
  };
  role: ('team_admin' | 'coach' | 'parent' | 'player') | string;
  positions?: string[];
  defaultChatId?: string;
  createdAt?: string;
}

export type TeamTheme = {
  primary?: string;
  secondary?: string;
  accent?: string;
  logoKey?: string;
}

export type TimeZone = string;

export type UpdateEventBody = {
  eventType?: 'practice' | 'game' | 'meeting' | 'fundraiser' | 'other';
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  location?: string | null;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval?: number;
    until?: string;
    count?: number;
    byWeekDay?: string[];
  } | null;
}

export type UpdatePositionsBody = {
  positions: string[];
}

export type UpdateProfileBody = {
  photoKey: string | null;
}

export type UpdateRolePermissionsBody = {
  /**
   * @minItems 1
   */
  roles: [
    {
      role: 'team_admin' | 'coach' | 'parent' | 'player';
      permissions: (
        | 'manage_permissions'
        | 'invite_members'
        | 'approve_join_requests'
        | 'assign_roles'
        | 'manage_events'
        | 'create_team_channels'
      )[];
    },
    ...{
      role: 'team_admin' | 'coach' | 'parent' | 'player';
      permissions: (
        | 'manage_permissions'
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
  theme?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    logoKey?: string;
  } | null;
}

export type UserProfile = {
  userId: string;
  email: string;
  displayName: string;
  accountKind: 'adult' | 'minor';
  birthday?: string;
  photoKey?: string;
  needsProfileCompletion?: boolean;
}

export const ACCOUNT_KINDS = ["adult", "minor"] as const;

export const CHAT_KINDS = ["default", "channel", "private"] as const;

export const DEVICE_PLATFORMS = ["ios", "android", "web"] as const;

export const EVENT_TYPES = ["practice", "game", "meeting", "fundraiser", "other"] as const;

export const RSVP_STATUSES = ["going", "not_going", "maybe"] as const;

export const TEAM_ROLES = ["team_admin", "coach", "parent", "player"] as const;

export const TEAM_PERMISSIONS = ["manage_permissions", "invite_members", "approve_join_requests", "assign_roles", "manage_events", "create_team_channels"] as const;

export const DEFAULT_ROLE_PERMISSIONS = {
  team_admin: ["manage_permissions", "invite_members", "approve_join_requests", "assign_roles", "manage_events", "create_team_channels"],
  coach: [],
  parent: [],
  player: [],
} as const;

export const MAX_UPLOAD_BYTES = 15728640;

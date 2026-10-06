/**
 * AUTO-GENERATED FILE — do not edit.
 *
 * Source: `@gameplan/schemas`
 * Generate: `npm run generate:types`
 */

export type AccountKind = 'adult' | 'minor';

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

export type ChatMessage = {
  messageId: string;
  chatId: string;
  senderId: string;
  body: string;
  attachmentKeys?: string[];
  createdAt: string;
}

export type ChatSummary = {
  chatId: string;
  kind: 'default' | 'channel' | 'private';
  name: string;
  teamId?: string;
}

export type CompleteProfileBody = {
  birthday: string;
  displayName?: string;
}

export type CreateEventBody = {
  eventType: 'practice' | 'game';
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

export type ErrorBody = {
  error: string;
}

export type EventType = 'practice' | 'game';

export type LoginBody = {
  email: string;
  password: string;
}

export type MessageHistoryQuery = {
  limit?: number;
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

export type RsvpStatus = 'going' | 'not_going' | 'maybe';

export type ScheduleOccurrence = {
  eventId: string;
  eventType: 'practice' | 'game';
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
  role: ('team_admin' | 'coach' | 'parent' | 'player') | string;
  defaultChatId?: string;
  createdAt?: string;
}

export type TimeZone = string;

export type UpdateEventBody = {
  eventType?: 'practice' | 'game';
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
}

export type UserProfile = {
  userId: string;
  email: string;
  displayName: string;
  accountKind: 'adult' | 'minor';
  birthday?: string;
  needsProfileCompletion?: boolean;
}

export const ACCOUNT_KINDS = ["adult", "minor"] as const;

export const CHAT_KINDS = ["default", "channel", "private"] as const;

export const DEVICE_PLATFORMS = ["ios", "android", "web"] as const;

export const EVENT_TYPES = ["practice", "game"] as const;

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

/**
 * Shared Zod schemas for the GamePlan product API.
 */

export { z, type ZodType } from './zod.js';
export { MAX_UPLOAD_BYTES } from './limits.js';
export { openApiDocument } from './openapi.js';
export {
  DEFAULT_ROLE_PERMISSIONS,
  TEAM_PERMISSIONS,
  TEAM_ROLES,
} from './constants.js';

export {
  ACCOUNT_KINDS,
  CHAT_KINDS,
  DEVICE_PLATFORMS,
  EVENT_TYPES,
  RSVP_STATUSES,
  accountKindSchema,
  chatKindSchema,
  devicePlatformSchema,
  eventTypeSchema,
  rsvpStatusSchema,
  teamPermissionSchema,
  teamRoleSchema,
  type AccountKind,
  type ChatKind,
  type DevicePlatform,
  type EventType,
  type RsvpStatus,
  type TeamPermission,
  type TeamRole,
} from './enums.js';

export {
  authUserSchema,
  completeProfileBodySchema,
  errorBodySchema,
  loginBodySchema,
  refreshBodySchema,
  registerBodySchema,
  sessionTokensSchema,
  userProfileSchema,
  type AuthUser,
  type CompleteProfileBody,
  type ErrorBody,
  type LoginBody,
  type RefreshBody,
  type RegisterBody,
  type SessionTokens,
  type UserProfile,
} from './auth.js';

export {
  approveJoinRequestBodySchema,
  assignRoleBodySchema,
  createInviteBodySchema,
  createTeamBodySchema,
  rolePermissionsSchema,
  searchTeamDirectoryQuerySchema,
  teamDirectoryHitSchema,
  teamSummarySchema,
  updateRolePermissionsBodySchema,
  updateTeamBodySchema,
  type ApproveJoinRequestBody,
  type AssignRoleBody,
  type CreateInviteBody,
  type CreateTeamBody,
  type RolePermissions,
  type SearchTeamDirectoryQuery,
  type TeamDirectoryHit,
  type TeamSummary,
  type UpdateRolePermissionsBody,
  type UpdateTeamBody,
} from './teams.js';

export {
  createEventBodySchema,
  recurrenceRuleSchema,
  rsvpBodySchema,
  scheduleOccurrenceSchema,
  scheduleWindowQuerySchema,
  updateEventBodySchema,
  type CreateEventBody,
  type RecurrenceRule,
  type RsvpBody,
  type ScheduleOccurrence,
  type ScheduleWindowQuery,
  type UpdateEventBody,
} from './schedule.js';

export {
  chatMessageSchema,
  chatSummarySchema,
  createPrivateChatBodySchema,
  createTeamChannelBodySchema,
  messageHistoryQuerySchema,
  searchUsersQuerySchema,
  sendMessageBodySchema,
  type ChatMessage,
  type ChatSummary,
  type CreatePrivateChatBody,
  type CreateTeamChannelBody,
  type MessageHistoryQuery,
  type SearchUsersQuery,
  type SendMessageBody,
} from './chat.js';

export {
  presignDownloadQuerySchema,
  presignDownloadResponseSchema,
  registerDeviceBodySchema,
  presignUploadBodySchema,
  presignUploadResponseSchema,
  type PresignDownloadQuery,
  type PresignDownloadResponse,
  type PresignUploadBody,
  type PresignUploadResponse,
  type RegisterDeviceBody,
} from './media.js';

export { timeZoneSchema, type TimeZone } from './time.js';

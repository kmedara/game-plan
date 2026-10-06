/**
 * Domain enumeration schemas shared across the product API.
 *
 * Literal arrays are the source of truth for both Zod enums and exported
 * const lists used by APIs and clients.
 */

import { z } from './zod.js';

/** Whether the account is an adult or a minor. */
export const ACCOUNT_KINDS = ['adult', 'minor'] as const;

/** Schema for {@link ACCOUNT_KINDS}. */
export const accountKindSchema = z.enum(ACCOUNT_KINDS);

/** Inferred type for {@link accountKindSchema}. */
export type AccountKind = z.infer<typeof accountKindSchema>;

/** Every team role, in a stable order for the admin matrix. */
export const TEAM_ROLES = ['team_admin', 'coach', 'parent', 'player'] as const;

/** Schema for {@link TEAM_ROLES}. */
export const teamRoleSchema = z.enum(TEAM_ROLES);

/** Inferred type for {@link teamRoleSchema}. */
export type TeamRole = z.infer<typeof teamRoleSchema>;

/** Every privileged team permission, in a stable order for the admin matrix. */
export const TEAM_PERMISSIONS = [
  'manage_permissions',
  'invite_members',
  'approve_join_requests',
  'assign_roles',
  'manage_events',
  'create_team_channels',
] as const;

/** Schema for {@link TEAM_PERMISSIONS}. */
export const teamPermissionSchema = z.enum(TEAM_PERMISSIONS);

/** Inferred type for {@link teamPermissionSchema}. */
export type TeamPermission = z.infer<typeof teamPermissionSchema>;

/** Chat kinds in v1. */
export const CHAT_KINDS = ['default', 'channel', 'private'] as const;

/** Schema for {@link CHAT_KINDS}. */
export const chatKindSchema = z.enum(CHAT_KINDS);

/** Inferred type for {@link chatKindSchema}. */
export type ChatKind = z.infer<typeof chatKindSchema>;

/** Schedule event types. `other` covers anything that is not a practice, game, or meeting. */
export const EVENT_TYPES = ['practice', 'game', 'meeting', 'fundraiser', 'other'] as const;

/** Schema for {@link EVENT_TYPES}. */
export const eventTypeSchema = z.enum(EVENT_TYPES);

/** Inferred type for {@link eventTypeSchema}. */
export type EventType = z.infer<typeof eventTypeSchema>;

/** Per-occurrence RSVP answers. */
export const RSVP_STATUSES = ['going', 'not_going', 'maybe'] as const;

/** Schema for {@link RSVP_STATUSES}. */
export const rsvpStatusSchema = z.enum(RSVP_STATUSES);

/** Inferred type for {@link rsvpStatusSchema}. */
export type RsvpStatus = z.infer<typeof rsvpStatusSchema>;

/** Push platforms supported for device token registration. */
export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;

/** Schema for {@link DEVICE_PLATFORMS}. */
export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS);

/** Inferred type for {@link devicePlatformSchema}. */
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

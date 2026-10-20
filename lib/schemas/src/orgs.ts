/**
 * Organizations: one club or league that owns many teams.
 */

import { displayNameSchema } from './display-name.js';
import { teamPlanSchema } from './plans.js';
import { z } from './zod.js';

/** Teams an organization plan includes before each extra team is billed. */
export const ORG_INCLUDED_TEAMS = 5;

/** Most teams one organization may hold. */
export const MAX_ORG_TEAMS = 200;

/** Most admins one organization may have. */
export const MAX_ORG_ADMINS = 20;

const orgName = z.string().trim().min(1).max(80);

/** Body for `POST /orgs`. */
export const createOrgBodySchema = z.object({ name: orgName }).strict();

/** Body for `PATCH /orgs/:orgId`. */
export const updateOrgBodySchema = z.object({ name: orgName }).strict();

/** Body for `POST /orgs/:orgId/admins`: an existing adult account, found by exact email. */
export const addOrgAdminBodySchema = z.object({ email: z.string().trim().email().max(320) }).strict();

/** Body for `POST /orgs/:orgId/announcements`. */
export const orgAnnouncementBodySchema = z
  .object({
    body: z.string().trim().min(1).max(2000),
    /** Teams to post to; all of the organization's teams when omitted. */
    teamIds: z.array(z.string().min(1)).max(MAX_ORG_TEAMS).optional(),
  })
  .strict();

/** One organization in a list. */
export const orgSummarySchema = z
  .object({
    orgId: z.string().min(1),
    name: z.string().min(1),
    ownerId: z.string().min(1),
    /** The caller is the owner, who manages admins and billing. */
    isOwner: z.boolean(),
    teamCount: z.number().int().min(0),
    plan: teamPlanSchema,
  })
  .strict();

/** `GET /orgs`. */
export const orgListSchema = z.object({ orgs: z.array(orgSummarySchema) }).strict();

/** One team in an organization, with what an admin needs at a glance. */
export const orgTeamSchema = z
  .object({
    teamId: z.string().min(1),
    name: z.string().min(1),
    sport: z.string().optional(),
    memberCount: z.number().int().min(0),
    /** Still waiting for the team's admin to accept. */
    pending: z.boolean(),
  })
  .strict();

/** `GET /orgs/:orgId`. */
export const orgDetailSchema = orgSummarySchema
  .extend({
    admins: z.array(z.object({ userId: z.string().min(1), displayName: displayNameSchema }).strict()),
    teams: z.array(orgTeamSchema),
    /** Teams past {@link ORG_INCLUDED_TEAMS}, billed per month on a paid plan. */
    extraTeams: z.number().int().min(0),
  })
  .strict();

/** `GET /orgs/teams/:teamId`: the team's organization, and invitations it can accept. */
export const teamOrgStatusSchema = z
  .object({
    org: z.object({ orgId: z.string().min(1), name: z.string().min(1) }).strict().optional(),
    invites: z.array(z.object({ orgId: z.string().min(1), name: z.string().min(1) }).strict()),
    /** On accepting: what was refunded from the team's own cancelled plan, in minor units. */
    refundedCents: z.number().int().min(0).optional(),
  })
  .strict();

/** Body for `POST /billing/orgs/:orgId/checkout`. */
export const orgCheckoutBodySchema = z
  .object({
    interval: z.enum(['month', 'year']),
    returnTo: z.enum(['app', 'web']).default('app'),
  })
  .strict();

/** Inferred type for {@link createOrgBodySchema}. */
export type CreateOrgBody = z.infer<typeof createOrgBodySchema>;

/** Inferred type for {@link updateOrgBodySchema}. */
export type UpdateOrgBody = z.infer<typeof updateOrgBodySchema>;

/** Inferred type for {@link addOrgAdminBodySchema}. */
export type AddOrgAdminBody = z.infer<typeof addOrgAdminBodySchema>;

/** Inferred type for {@link orgAnnouncementBodySchema}. */
export type OrgAnnouncementBody = z.infer<typeof orgAnnouncementBodySchema>;

/** Inferred type for {@link orgSummarySchema}. */
export type OrgSummary = z.infer<typeof orgSummarySchema>;

/** Inferred type for {@link orgListSchema}. */
export type OrgList = z.infer<typeof orgListSchema>;

/** Inferred type for {@link orgTeamSchema}. */
export type OrgTeam = z.infer<typeof orgTeamSchema>;

/** Inferred type for {@link orgDetailSchema}. */
export type OrgDetail = z.infer<typeof orgDetailSchema>;

/** Inferred type for {@link teamOrgStatusSchema}. */
export type TeamOrgStatus = z.infer<typeof teamOrgStatusSchema>;

/** Inferred type for {@link orgCheckoutBodySchema}. */
export type OrgCheckoutBody = z.infer<typeof orgCheckoutBodySchema>;

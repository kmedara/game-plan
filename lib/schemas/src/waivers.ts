/**
 * Waiver wire contracts: team waivers, signatures, and organization templates.
 *
 * A waiver is a team artifact. Its text is versioned: changing the title or
 * body makes a new version, and a signature always names the version it
 * covers, so what someone agreed to never changes under them. An organization
 * template is copied onto a team; editing the template later leaves the copy alone.
 */

import { accountKindSchema, teamRoleSchema } from './enums.js';
import { z } from './zod.js';

/** How a signature was given: in the app, or on paper and recorded by staff. */
export const WAIVER_SIGNATURE_METHODS = ['electronic', 'paper'] as const;

/** Schema for {@link WAIVER_SIGNATURE_METHODS}. */
export const waiverSignatureMethodSchema = z.enum(WAIVER_SIGNATURE_METHODS);

/** Inferred type for {@link waiverSignatureMethodSchema}. */
export type WaiverSignatureMethod = z.infer<typeof waiverSignatureMethodSchema>;

/**
 * Who signed, relative to the member the waiver is for.
 *
 * `staff` is a paper form staff recorded; the name on it is the signer's.
 */
export const WAIVER_SIGNER_RELATIONSHIPS = ['self', 'guardian', 'staff'] as const;

/** Schema for {@link WAIVER_SIGNER_RELATIONSHIPS}. */
export const waiverSignerRelationshipSchema = z.enum(WAIVER_SIGNER_RELATIONSHIPS);

/** Inferred type for {@link waiverSignerRelationshipSchema}. */
export type WaiverSignerRelationship = z.infer<typeof waiverSignerRelationshipSchema>;

/**
 * Where one member stands on one waiver.
 *
 * `outdated` means they signed an earlier version; the current text still needs a signature.
 */
export const WAIVER_MEMBER_STATUSES = ['signed', 'outdated', 'missing'] as const;

/** Schema for {@link WAIVER_MEMBER_STATUSES}. */
export const waiverMemberStatusSchema = z.enum(WAIVER_MEMBER_STATUSES);

/** Inferred type for {@link waiverMemberStatusSchema}. */
export type WaiverMemberStatus = z.infer<typeof waiverMemberStatusSchema>;

/** Longest waiver body. A long liability release is about 3,000 words. */
export const MAX_WAIVER_BODY_CHARS = 20_000;

/** Most waivers one team may hold, archived ones included. */
export const MAX_TEAM_WAIVERS = 50;

/** Most templates one organization may hold. */
export const MAX_ORG_WAIVER_TEMPLATES = 50;

/** Calendar date `YYYY-MM-DD`. */
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'invalid_date');

const waiverTitle = z.string().trim().min(1).max(120);

const waiverBody = z.string().trim().min(1).max(MAX_WAIVER_BODY_CHARS);

/** Roles whose members must sign. Players by default: the waiver covers the athlete. */
const waiverAudience = z
  .array(teamRoleSchema)
  .min(1)
  .max(4)
  .refine((roles) => new Set(roles).size === roles.length, { message: 'duplicate_role' });

/** The legal name the signer types. */
const signerName = z.string().trim().min(2).max(120);

/** Body for `POST /teams/:teamId/waivers`. */
export const createWaiverBodySchema = z
  .object({
    title: waiverTitle,
    body: waiverBody,
    audience: waiverAudience.default(['player']),
    dueDate: dateOnlySchema.optional(),
  })
  .strict();

/** Body for `POST /teams/:teamId/waivers/from-template`: copy one of the team's organization's templates. */
export const createWaiverFromTemplateBodySchema = z
  .object({
    templateId: z.string().min(1).max(64),
    dueDate: dateOnlySchema.optional(),
  })
  .strict();

/**
 * Body for `PATCH /teams/:teamId/waivers/:waiverId`.
 *
 * A new title or body makes a new version that everyone signs again. The due
 * date, audience, and archive flag change in place.
 */
export const updateWaiverBodySchema = z
  .object({
    title: waiverTitle.optional(),
    body: waiverBody.optional(),
    audience: waiverAudience.optional(),
    /** `null` clears the due date. */
    dueDate: dateOnlySchema.nullable().optional(),
    /** Archived waivers stop asking for signatures; their signatures stay. */
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'empty_update' });

/**
 * Body for `POST /teams/:teamId/waivers/:waiverId/signatures/:memberId`.
 *
 * `version` must be the one the signer read, so an edit made while they were
 * reading cannot be signed unseen.
 */
export const signWaiverBodySchema = z
  .object({
    version: z.number().int().min(1),
    signerName,
    agree: z.literal(true),
  })
  .strict();

/** Body for `PUT /teams/:teamId/waivers/:waiverId/signatures/:memberId/paper`: staff record a paper form. */
export const recordPaperWaiverBodySchema = z
  .object({
    /** The name signed on the paper form. */
    signerName,
  })
  .strict();

/** Signed and missing counts for one waiver. */
export const waiverTotalsSchema = z
  .object({
    /** Members who must sign: on the roster and holding a role in the audience. */
    members: z.number().int().min(0),
    signed: z.number().int().min(0),
    missing: z.number().int().min(0),
  })
  .strict();

/** One team waiver at its current version, for staff. */
export const waiverSchema = z
  .object({
    teamId: z.string().min(1),
    waiverId: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    version: z.number().int().min(1),
    audience: z.array(teamRoleSchema).min(1),
    dueDate: dateOnlySchema.optional(),
    archived: z.boolean(),
    /** Set when the waiver was copied from an organization template. */
    orgId: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    createdBy: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    totals: waiverTotalsSchema,
  })
  .strict();

/** `GET /teams/:teamId/waivers`. */
export const waiverListSchema = z
  .object({
    teamId: z.string().min(1),
    waivers: z.array(waiverSchema),
  })
  .strict();

/** One member's standing on a waiver, for the staff missing list. */
export const waiverMemberSchema = z
  .object({
    memberId: z.string().min(1),
    memberName: z.string().optional(),
    accountKind: accountKindSchema.optional(),
    status: waiverMemberStatusSchema,
    /** The member's latest signature, current or not. */
    signedVersion: z.number().int().min(1).optional(),
    signedAt: z.string().min(1).optional(),
    signerName: z.string().optional(),
    method: waiverSignatureMethodSchema.optional(),
    /** `false` for a minor with no linked guardian: staff need a paper form. */
    canSignInApp: z.boolean(),
  })
  .strict();

/** `GET /teams/:teamId/waivers/:waiverId`. */
export const waiverDetailSchema = z
  .object({
    waiver: waiverSchema,
    members: z.array(waiverMemberSchema),
  })
  .strict();

/** One signature, with the exact text it covers. */
export const waiverSignatureSchema = z
  .object({
    teamId: z.string().min(1),
    waiverId: z.string().min(1),
    memberId: z.string().min(1),
    version: z.number().int().min(1),
    /** Title and body as they read at that version. */
    title: z.string().min(1),
    body: z.string().min(1),
    /** SHA-256 of the title and body, hex, so a copy can be checked against the record. */
    textHash: z.string().regex(/^[0-9a-f]{64}$/u),
    method: waiverSignatureMethodSchema,
    relationship: waiverSignerRelationshipSchema,
    signerName: z.string().min(1),
    /** The account that signed, or the staff member who recorded the paper form. */
    signedBy: z.string().min(1),
    signedAt: z.string().min(1),
  })
  .strict();

/**
 * `POST /teams/:teamId/waivers/:waiverId/signatures/:memberId/pdf-link`.
 *
 * Open `GET /teams/waiver-pdf/:ticket` within `expiresIn` seconds for the signed copy as a PDF.
 */
export const waiverPdfLinkSchema = z
  .object({
    ticket: z.string().min(1),
    expiresIn: z.number().int().min(1),
  })
  .strict();

/** A waiver the caller, or a child of theirs, is asked to sign. */
export const myWaiverSchema = z
  .object({
    teamId: z.string().min(1),
    teamName: z.string().optional(),
    waiverId: z.string().min(1),
    memberId: z.string().min(1),
    memberName: z.string().optional(),
    title: z.string().min(1),
    body: z.string().min(1),
    version: z.number().int().min(1),
    dueDate: dateOnlySchema.optional(),
    status: waiverMemberStatusSchema,
    signedAt: z.string().min(1).optional(),
    /** Whether the caller may sign it (a minor's waivers are signed by a guardian). */
    canSign: z.boolean(),
  })
  .strict();

/** `GET /teams/me/waivers`. */
export const myWaiversSchema = z
  .object({
    waivers: z.array(myWaiverSchema),
  })
  .strict();

/** Body for `POST /orgs/:orgId/waiver-templates`. */
export const createWaiverTemplateBodySchema = z
  .object({
    title: waiverTitle,
    body: waiverBody,
    audience: waiverAudience.default(['player']),
  })
  .strict();

/** Body for `PATCH /orgs/:orgId/waiver-templates/:templateId`. Teams that copied it keep their copy. */
export const updateWaiverTemplateBodySchema = z
  .object({
    title: waiverTitle.optional(),
    body: waiverBody.optional(),
    audience: waiverAudience.optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'empty_update' });

/** One organization waiver template. */
export const waiverTemplateSchema = z
  .object({
    orgId: z.string().min(1),
    templateId: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    audience: z.array(teamRoleSchema).min(1),
    createdBy: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

/**
 * `GET /orgs/:orgId/waiver-templates` and `GET /teams/:teamId/waiver-templates`.
 *
 * A team outside an organization gets no `orgId` and no templates.
 */
export const waiverTemplateListSchema = z
  .object({
    orgId: z.string().min(1).optional(),
    templates: z.array(waiverTemplateSchema),
  })
  .strict();

/** Inferred type for {@link createWaiverBodySchema}. */
export type CreateWaiverBody = z.infer<typeof createWaiverBodySchema>;

/** Inferred type for {@link createWaiverFromTemplateBodySchema}. */
export type CreateWaiverFromTemplateBody = z.infer<typeof createWaiverFromTemplateBodySchema>;

/** Inferred type for {@link updateWaiverBodySchema}. */
export type UpdateWaiverBody = z.infer<typeof updateWaiverBodySchema>;

/** Inferred type for {@link signWaiverBodySchema}. */
export type SignWaiverBody = z.infer<typeof signWaiverBodySchema>;

/** Inferred type for {@link recordPaperWaiverBodySchema}. */
export type RecordPaperWaiverBody = z.infer<typeof recordPaperWaiverBodySchema>;

/** Inferred type for {@link waiverTotalsSchema}. */
export type WaiverTotals = z.infer<typeof waiverTotalsSchema>;

/** Inferred type for {@link waiverSchema}. */
export type Waiver = z.infer<typeof waiverSchema>;

/** Inferred type for {@link waiverListSchema}. */
export type WaiverList = z.infer<typeof waiverListSchema>;

/** Inferred type for {@link waiverMemberSchema}. */
export type WaiverMember = z.infer<typeof waiverMemberSchema>;

/** Inferred type for {@link waiverDetailSchema}. */
export type WaiverDetail = z.infer<typeof waiverDetailSchema>;

/** Inferred type for {@link waiverSignatureSchema}. */
export type WaiverSignature = z.infer<typeof waiverSignatureSchema>;

/** Inferred type for {@link waiverPdfLinkSchema}. */
export type WaiverPdfLink = z.infer<typeof waiverPdfLinkSchema>;

/** Inferred type for {@link myWaiverSchema}. */
export type MyWaiver = z.infer<typeof myWaiverSchema>;

/** Inferred type for {@link myWaiversSchema}. */
export type MyWaivers = z.infer<typeof myWaiversSchema>;

/** Inferred type for {@link createWaiverTemplateBodySchema}. */
export type CreateWaiverTemplateBody = z.infer<typeof createWaiverTemplateBodySchema>;

/** Inferred type for {@link updateWaiverTemplateBodySchema}. */
export type UpdateWaiverTemplateBody = z.infer<typeof updateWaiverTemplateBodySchema>;

/** Inferred type for {@link waiverTemplateSchema}. */
export type WaiverTemplate = z.infer<typeof waiverTemplateSchema>;

/** Inferred type for {@link waiverTemplateListSchema}. */
export type WaiverTemplateList = z.infer<typeof waiverTemplateListSchema>;

/**
 * Team waivers: staff write them and see who is missing; members and
 * guardians sign them.
 *
 * Writing or changing a waiver needs a plan with `waivers`. Reading and
 * signing do not, so a lapsed card never blocks a parent mid-season or hides
 * a signed record.
 */

import { canWithRoles, rolesFromMembership } from '@gameplan/rules';
import {
  createWaiverBodySchema,
  createWaiverFromTemplateBodySchema,
  recordPaperWaiverBodySchema,
  signWaiverBodySchema,
  updateWaiverBodySchema,
} from '@gameplan/schemas';
import { getItem, teamMemberSk, teamPk } from '../../../lib/dynamo/index.js';
import { requireEntitlement } from '../../../lib/entitlements.js';
import { requireMembership, requirePermission, requireUser } from '../../../lib/guards.js';
import { binary, json } from '../../../lib/http.js';
import { administersTeamOrg } from '../../../lib/orgs.js';
import { loadRolePermissionMatrix } from '../../../lib/permissions.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  createWaiver,
  createWaiverFromTemplate,
  getSignature,
  listMyWaivers,
  listTeamWaiverTemplates,
  listWaivers,
  mayReadOwnSignature,
  recordPaperSignature,
  removePaperSignature,
  signWaiver,
  updateWaiver,
  waiverDetail,
} from '../waiver-store.js';
import { issueWaiverPdfTicket, readWaiverPdfTicket, renderWaiverPdf } from '../waiver-pdf.js';
import { withTeamsErrors } from './errors.js';

/**
 * Whether the caller manages the team's waivers, without requiring them on the roster.
 *
 * An organization admin counts as `team_admin`, as in `requireMembership`.
 *
 * @param teamId - The team.
 * @param userId - The caller.
 * @returns `true` when their roles grant `manage_waivers`.
 */
const managesWaivers = async (teamId: string, userId: string): Promise<boolean> => {
  const member = await getItem<{ role?: unknown; roles?: unknown }>(teamPk(teamId), teamMemberSk(userId));
  const roles = member === undefined ? [] : rolesFromMembership(member);
  if (roles.length === 0) return administersTeamOrg(teamId, userId);
  return canWithRoles(roles, await loadRolePermissionMatrix(teamId), 'manage_waivers');
};

/**
 * `GET /teams/me/waivers`
 *
 * Waivers the caller signs for themselves or a child, on every team.
 */
export const handleListMyWaivers = route(
  'GET',
  '/teams/me/waivers',
  withTeamsErrors(),
  requireUser(),
  async ({ user }) => json(200, { waivers: await listMyWaivers(user.userId) }),
);

/** `GET /teams/:teamId/waivers` */
export const handleListWaivers = route(
  'GET',
  '/teams/:teamId/waivers',
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('manage_waivers'),
  async ({ teamId }) => json(200, { teamId, waivers: await listWaivers(teamId) }),
);

/** `POST /teams/:teamId/waivers` */
export const handleCreateWaiver = route(
  'POST',
  '/teams/:teamId/waivers',
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(createWaiverBodySchema),
  requireMembership(),
  requirePermission('manage_waivers'),
  requireEntitlement('waivers'),
  async ({ teamId, user, body }) => json(201, await createWaiver({ teamId, userId: user.userId, body })),
);

/** `GET /teams/:teamId/waiver-templates` — the templates the team's organization offers. */
export const handleListTeamWaiverTemplates = route(
  'GET',
  '/teams/:teamId/waiver-templates',
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('manage_waivers'),
  async ({ teamId }) => json(200, await listTeamWaiverTemplates(teamId)),
);

/** `POST /teams/:teamId/waivers/from-template` */
export const handleCreateWaiverFromTemplate = route(
  'POST',
  '/teams/:teamId/waivers/from-template',
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(createWaiverFromTemplateBodySchema),
  requireMembership(),
  requirePermission('manage_waivers'),
  requireEntitlement('waivers'),
  async ({ teamId, user, body }) =>
    json(
      201,
      await createWaiverFromTemplate({
        teamId,
        userId: user.userId,
        templateId: body.templateId,
        ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
      }),
    ),
);

/** `GET /teams/:teamId/waivers/:waiverId` — the waiver and who is missing. */
export const handleGetWaiver = route(
  'GET',
  '/teams/:teamId/waivers/:waiverId',
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('manage_waivers'),
  async ({ teamId, waiverId }) => json(200, await waiverDetail(teamId, waiverId)),
);

/**
 * `PATCH /teams/:teamId/waivers/:waiverId`
 *
 * A new title or body is a new version that everyone signs again.
 */
export const handleUpdateWaiver = route(
  'PATCH',
  '/teams/:teamId/waivers/:waiverId',
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(updateWaiverBodySchema),
  requireMembership(),
  requirePermission('manage_waivers'),
  requireEntitlement('waivers'),
  async ({ teamId, waiverId, user, body }) =>
    json(200, await updateWaiver({ teamId, waiverId, userId: user.userId, body })),
);

/**
 * `POST /teams/:teamId/waivers/:waiverId/signatures/:memberId`
 *
 * An adult signs their own; a guardian signs a minor's. The signer need not
 * be on the team.
 */
export const handleSignWaiver = route(
  'POST',
  '/teams/:teamId/waivers/:waiverId/signatures/:memberId',
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(signWaiverBodySchema),
  async ({ teamId, waiverId, memberId, user, body }) =>
    json(
      201,
      await signWaiver({
        teamId,
        waiverId,
        memberId,
        signerId: user.userId,
        version: body.version,
        signerName: body.signerName,
      }),
    ),
);

/**
 * `GET /teams/:teamId/waivers/:waiverId/signatures/:memberId`
 *
 * The signed record and the exact text it covers, for the member, their
 * guardians, and staff who manage waivers.
 */
export const handleGetSignature = route(
  'GET',
  '/teams/:teamId/waivers/:waiverId/signatures/:memberId',
  withTeamsErrors(),
  requireUser(),
  async ({ teamId, waiverId, memberId, user }) => {
    const allowed =
      (await mayReadOwnSignature(user.userId, memberId)) || (await managesWaivers(teamId, user.userId));
    if (!allowed) throw new Error('forbidden');
    return json(200, await getSignature(teamId, waiverId, memberId));
  },
);

/**
 * `POST /teams/:teamId/waivers/:waiverId/signatures/:memberId/pdf-link`
 *
 * A short-lived ticket for the signed copy's PDF, for the same people who may
 * see the signature. The app opens `GET /teams/waiver-pdf/:ticket` in the browser.
 */
export const handleCreateWaiverPdfLink = route(
  'POST',
  '/teams/:teamId/waivers/:waiverId/signatures/:memberId/pdf-link',
  withTeamsErrors(),
  requireUser(),
  async ({ teamId, waiverId, memberId, user }) => {
    const allowed =
      (await mayReadOwnSignature(user.userId, memberId)) || (await managesWaivers(teamId, user.userId));
    if (!allowed) throw new Error('forbidden');
    await getSignature(teamId, waiverId, memberId);
    return json(200, await issueWaiverPdfTicket({ teamId, waiverId, memberId, userId: user.userId }));
  },
);

/**
 * `GET /teams/waiver-pdf/:ticket`
 *
 * The signed copy as a PDF. Needs no sign-in: the ticket from the route above
 * stands in for it, for a few minutes and one signature.
 */
export const handleGetWaiverPdf = route(
  'GET',
  '/teams/waiver-pdf/:ticket',
  withTeamsErrors(),
  async ({ ticket }) => {
    const { fileName, bytes } = await renderWaiverPdf(await readWaiverPdfTicket(ticket));
    const result = binary(200, 'application/pdf', bytes);
    return {
      ...result,
      headers: {
        ...result.headers,
        'content-disposition': `inline; filename="${fileName}"`,
        'cache-control': 'private, no-store',
      },
    };
  },
);

/** `PUT /teams/:teamId/waivers/:waiverId/signatures/:memberId/paper` — staff record a paper form. */
export const handleRecordPaperWaiver = route(
  'PUT',
  '/teams/:teamId/waivers/:waiverId/signatures/:memberId/paper',
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(recordPaperWaiverBodySchema),
  requireMembership(),
  requirePermission('manage_waivers'),
  async ({ teamId, waiverId, memberId, user, body }) =>
    json(
      201,
      await recordPaperSignature({ teamId, waiverId, memberId, staffId: user.userId, signerName: body.signerName }),
    ),
);

/** `DELETE /teams/:teamId/waivers/:waiverId/signatures/:memberId/paper` — undo a paper form recorded by mistake. */
export const handleRemovePaperWaiver = route(
  'DELETE',
  '/teams/:teamId/waivers/:waiverId/signatures/:memberId/paper',
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('manage_waivers'),
  async ({ teamId, waiverId, memberId }) => {
    await removePaperSignature({ teamId, waiverId, memberId });
    return { statusCode: 204 };
  },
);

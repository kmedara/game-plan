/**
 * Organization waiver templates, for the organization's admins.
 */

import { createWaiverTemplateBodySchema, updateWaiverTemplateBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  createWaiverTemplate,
  deleteWaiverTemplate,
  listWaiverTemplates,
  updateWaiverTemplate,
} from '../waiver-templates.js';
import { withOrgsErrors } from './errors.js';

/** `GET /orgs/:orgId/waiver-templates` */
export const handleListWaiverTemplates = route(
  'GET',
  '/orgs/:orgId/waiver-templates',
  withOrgsErrors(),
  requireUser(),
  async ({ orgId, user }) => json(200, { orgId, templates: await listWaiverTemplates(orgId, user.userId) }),
);

/** `POST /orgs/:orgId/waiver-templates` — needs the organization plan. */
export const handleCreateWaiverTemplate = route(
  'POST',
  '/orgs/:orgId/waiver-templates',
  withOrgsErrors(),
  requireUser(),
  withBodyValidation(createWaiverTemplateBodySchema),
  async ({ orgId, user, body }) => json(201, await createWaiverTemplate({ orgId, userId: user.userId, body })),
);

/** `PATCH /orgs/:orgId/waiver-templates/:templateId` — teams' copies stay as they are. */
export const handleUpdateWaiverTemplate = route(
  'PATCH',
  '/orgs/:orgId/waiver-templates/:templateId',
  withOrgsErrors(),
  requireUser(),
  withBodyValidation(updateWaiverTemplateBodySchema),
  async ({ orgId, templateId, user, body }) =>
    json(200, await updateWaiverTemplate({ orgId, templateId, userId: user.userId, body })),
);

/** `DELETE /orgs/:orgId/waiver-templates/:templateId` */
export const handleDeleteWaiverTemplate = route(
  'DELETE',
  '/orgs/:orgId/waiver-templates/:templateId',
  withOrgsErrors(),
  requireUser(),
  async ({ orgId, templateId, user }) => {
    await deleteWaiverTemplate({ orgId, templateId, userId: user.userId });
    return { statusCode: 204, body: '' };
  },
);

/**
 * Organization waiver templates: an admin writes a waiver once, and each
 * member team attaches its own copy (`POST /teams/:teamId/waivers/from-template`).
 *
 * Rows: `ORG#<orgId>` / `WAIVER_TEMPLATE#<templateId>`. A team's copy is its
 * own from the moment it is made, so editing or deleting a template never
 * changes what anyone signed.
 */

import { randomUUID } from 'node:crypto';
import { effectivePlanTier, PLAN_LIMITS } from '@gameplan/rules';
import {
  MAX_ORG_WAIVER_TEMPLATES,
  type CreateWaiverTemplateBody,
  type UpdateWaiverTemplateBody,
  type WaiverTemplate,
} from '@gameplan/schemas';
import {
  ORG_WAIVER_TEMPLATE_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  deleteItem,
  getItem,
  orgPk,
  orgWaiverTemplateSk,
  putItem,
  queryBySkPrefix,
} from '../../lib/dynamo/index.js';
import { orgPlan } from '../../lib/orgs.js';
import { requireOrgAdmin } from './orgs-store.js';

/**
 * Requires the organization plan, which is what sells shared templates.
 *
 * @param orgId - The organization.
 * @throws `plan_required`.
 */
const requireOrgFeatures = async (orgId: string): Promise<void> => {
  if (!PLAN_LIMITS[effectivePlanTier(await orgPlan(orgId))].orgFeatures) throw new Error('plan_required');
};

/**
 * Drops table keys from a stored template.
 *
 * @param row - The stored row.
 * @returns The wire template.
 */
const toWire = ({ PK: _pk, SK: _sk, ...template }: WaiverTemplate & { PK?: unknown; SK?: unknown }): WaiverTemplate =>
  template;

/**
 * Loads one template.
 *
 * @param orgId - The organization.
 * @param templateId - The template.
 * @returns The stored template.
 * @throws `template_not_found`.
 */
const requireTemplate = async (orgId: string, templateId: string): Promise<WaiverTemplate> => {
  const row = await getItem<WaiverTemplate>(orgPk(orgId), orgWaiverTemplateSk(templateId));
  if (row === undefined) throw new Error('template_not_found');
  return toWire(row);
};

/**
 * Every template in an organization, by title.
 *
 * @param orgId - The organization.
 * @param userId - The caller, who must be an admin.
 * @returns The templates.
 */
export const listWaiverTemplates = async (orgId: string, userId: string): Promise<WaiverTemplate[]> => {
  await requireOrgAdmin(orgId, userId);
  const rows = await queryBySkPrefix<WaiverTemplate>(orgPk(orgId), ORG_WAIVER_TEMPLATE_SK_PREFIX);
  return rows.map(toWire).sort((left, right) => left.title.localeCompare(right.title));
};

/**
 * Adds a template.
 *
 * @param input - The organization, the admin, and the text.
 * @returns The new template.
 * @throws `plan_required`, or `too_many_templates` past {@link MAX_ORG_WAIVER_TEMPLATES}.
 */
export const createWaiverTemplate = async (input: {
  orgId: string;
  userId: string;
  body: CreateWaiverTemplateBody;
}): Promise<WaiverTemplate> => {
  await requireOrgAdmin(input.orgId, input.userId);
  await requireOrgFeatures(input.orgId);
  const existing = await queryBySkPrefix(orgPk(input.orgId), ORG_WAIVER_TEMPLATE_SK_PREFIX);
  if (existing.length >= MAX_ORG_WAIVER_TEMPLATES) throw new Error('too_many_templates');
  const at = new Date().toISOString();
  const template: WaiverTemplate = {
    orgId: input.orgId,
    templateId: randomUUID(),
    title: input.body.title,
    body: input.body.body,
    audience: input.body.audience,
    createdBy: input.userId,
    createdAt: at,
    updatedAt: at,
  };
  await putItem({ [TABLE_PK]: orgPk(input.orgId), [TABLE_SK]: orgWaiverTemplateSk(template.templateId), ...template });
  return template;
};

/**
 * Changes a template. Teams that already copied it keep their copy.
 *
 * @param input - The organization, the admin, the template, and the changes.
 * @returns The stored template.
 * @throws `plan_required` or `template_not_found`.
 */
export const updateWaiverTemplate = async (input: {
  orgId: string;
  userId: string;
  templateId: string;
  body: UpdateWaiverTemplateBody;
}): Promise<WaiverTemplate> => {
  await requireOrgAdmin(input.orgId, input.userId);
  await requireOrgFeatures(input.orgId);
  const current = await requireTemplate(input.orgId, input.templateId);
  const next: WaiverTemplate = {
    ...current,
    title: input.body.title ?? current.title,
    body: input.body.body ?? current.body,
    audience: input.body.audience ?? current.audience,
    updatedAt: new Date().toISOString(),
  };
  await putItem({ [TABLE_PK]: orgPk(input.orgId), [TABLE_SK]: orgWaiverTemplateSk(next.templateId), ...next });
  return next;
};

/**
 * Deletes a template. Teams' copies, and every signature on them, stay.
 *
 * @param input - The organization, the admin, and the template.
 * @throws `template_not_found`.
 */
export const deleteWaiverTemplate = async (input: { orgId: string; userId: string; templateId: string }): Promise<void> => {
  await requireOrgAdmin(input.orgId, input.userId);
  await requireTemplate(input.orgId, input.templateId);
  await deleteItem(orgPk(input.orgId), orgWaiverTemplateSk(input.templateId));
};

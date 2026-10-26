/**
 * Small waiver decisions the screens share, kept free of React so they can be tested.
 */

import type { MyWaiver, TeamRole } from '@gameplan/types';
import { TEAM_ROLES } from '@gameplan/types';

/** Error codes from the waiver API, by translation key. */
export const WAIVER_ERRORS = {
  waiver_changed: 'errors.waivers.changed',
  already_signed: 'errors.waivers.alreadySigned',
  waiver_archived: 'errors.waivers.archived',
  not_signer: 'errors.waivers.notSigner',
  member_not_asked: 'errors.waivers.notAsked',
  too_many_waivers: 'errors.waivers.tooMany',
  too_many_templates: 'errors.waivers.tooManyTemplates',
  template_not_found: 'errors.waivers.templateNotFound',
  signed_in_app: 'errors.waivers.signedInApp',
  plan_required: 'errors.waivers.planRequired',
  pdf_link_expired: 'errors.waivers.pdfFailed',
  pdf_failed: 'errors.waivers.pdfFailed',
} as const;

/** Shortest legal name the API accepts. */
export const MIN_SIGNER_NAME = 2;

/**
 * Adds or removes a role from a waiver's audience, never leaving it empty.
 *
 * @param audience - Roles asked to sign now.
 * @param role - The role tapped.
 * @returns The new audience in rank order.
 */
export const toggleAudienceRole = (audience: readonly TeamRole[], role: TeamRole): TeamRole[] => {
  const next = audience.includes(role) ? audience.filter((held) => held !== role) : [...audience, role];
  if (next.length === 0) return [...audience];
  return TEAM_ROLES.filter((candidate) => next.includes(candidate));
};

/**
 * Whether the signer has typed a name and ticked the box.
 *
 * @param signerName - The name typed.
 * @param agreed - Whether the agreement box is ticked.
 * @returns `true` when the sign button may be pressed.
 */
export const signatureReady = (signerName: string, agreed: boolean): boolean =>
  agreed && signerName.trim().length >= MIN_SIGNER_NAME;

/**
 * How many waivers the caller still has to sign, for the profile button.
 *
 * @param waivers - The caller's list.
 * @returns Waivers the caller can sign and has not.
 */
export const waiversToSign = (waivers: readonly MyWaiver[]): number =>
  waivers.filter((waiver) => waiver.canSign && waiver.status !== 'signed').length;

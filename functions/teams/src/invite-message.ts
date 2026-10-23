/**
 * Text of the invites GamePlan emails and texts for a team.
 *
 * Built here rather than taken from the app, so a request can only choose the
 * recipient, role, and language, never the words sent in GamePlan's name.
 */

import type { TeamRole } from '@gameplan/types';

/** Languages an invite can be written in; matches `INVITE_MESSAGE_LOCALES`. */
export type InviteLocale = 'en' | 'es';

/** Longest team or inviter name placed in a message. */
const MAX_NAME_LENGTH = 60;

/** Role names in each language, matching the app's `role.*` copy. */
const ROLE_NAMES: Readonly<Record<InviteLocale, Readonly<Record<TeamRole, string>>>> = {
  en: { team_admin: 'Team admin', coach: 'Coach', parent: 'Parent', player: 'Player' },
  es: { team_admin: 'Administrador', coach: 'Entrenador', parent: 'Padre/madre', player: 'Jugador' },
};

/** What every invite message says. */
export type InviteMessageInput = {
  locale: InviteLocale;
  inviterName: string;
  teamName: string;
  role: TeamRole;
  code: string;
  /** Invite page on the website, which opens the app when it is installed. */
  url: string;
};

/**
 * Makes a user-entered name safe to place in a message: one line, no control
 * characters, and a bounded length.
 *
 * @param value - A team or display name.
 * @returns The cleaned name.
 */
export const messageName = (value: string): string => {
  const flat = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return flat.length <= MAX_NAME_LENGTH ? flat : `${flat.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
};

/**
 * Escapes text for an HTML email body.
 *
 * @param value - Plain text.
 * @returns Text safe inside an element or a quoted attribute.
 */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');

/**
 * The text message. Carriers require the brand and opt-out wording.
 *
 * @param input - Inviter, team, role, code, and link.
 * @returns The SMS body.
 */
export const inviteTextMessage = (input: InviteMessageInput): string => {
  const inviter = messageName(input.inviterName);
  const team = messageName(input.teamName);
  const role = ROLE_NAMES[input.locale][input.role];
  return input.locale === 'es'
    ? `GamePlan: ${inviter} te invitó a unirte a ${team} como ${role}. Código ${input.code}: ${input.url} Responde STOP para no recibir más mensajes.`
    : `GamePlan: ${inviter} invited you to join ${team} as ${role}. Code ${input.code}: ${input.url} Reply STOP to opt out.`;
};

/** An email's subject and bodies. */
export type InviteEmail = { subject: string; text: string; html: string };

/**
 * The invite email.
 *
 * @param input - Inviter, team, role, code, and link.
 * @returns Subject, plain text, and HTML.
 */
export const inviteEmail = (input: InviteMessageInput): InviteEmail => {
  const inviter = messageName(input.inviterName);
  const team = messageName(input.teamName);
  const role = ROLE_NAMES[input.locale][input.role];
  const copy =
    input.locale === 'es'
      ? {
          subject: `${inviter} te invitó a unirte a ${team} en GamePlan`,
          lead: `${inviter} te invitó a unirte a ${team} en GamePlan como ${role}.`,
          button: 'Unirme al equipo',
          code: `O abre GamePlan e ingresa el código de invitación ${input.code}.`,
          footer: `Recibiste este correo porque ${inviter} escribió tu dirección en GamePlan. Responde para escribirle.`,
        }
      : {
          subject: `${inviter} invited you to join ${team} on GamePlan`,
          lead: `${inviter} invited you to join ${team} on GamePlan as ${role}.`,
          button: 'Join the team',
          code: `Or open GamePlan and enter the invite code ${input.code}.`,
          footer: `You got this email because ${inviter} entered your address in GamePlan. Reply to reach them.`,
        };
  const text = [copy.lead, '', `${copy.button}: ${input.url}`, '', copy.code, '', copy.footer].join('\n');
  const html = [
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.5">',
    `<p>${escapeHtml(copy.lead)}</p>`,
    `<p><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#0a6e38;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(copy.button)}</a></p>`,
    `<p>${escapeHtml(copy.code)}</p>`,
    `<p style="color:#666666;font-size:13px">${escapeHtml(copy.footer)}</p>`,
    '</body></html>',
  ].join('');
  return { subject: copy.subject, text, html };
};

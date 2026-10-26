/**
 * A signed waiver as a PDF: the exact text that was signed, then the record
 * of who signed it, when, and how.
 *
 * The app cannot attach a sign-in token to a link the browser or system PDF
 * viewer opens, so a signed-in caller first gets a short-lived ticket, and the
 * PDF route reads the ticket instead. A ticket works for
 * {@link WAIVER_PDF_TICKET_TTL_SECONDS} seconds and only for the one signature.
 */

import { randomBytes } from 'node:crypto';
import type { WaiverSignature } from '@gameplan/schemas';
import {
  TABLE_PK,
  TABLE_SK,
  WAIVER_PDF_TICKET_TTL_SECONDS,
  getItem,
  putItem,
  teamMetaSk,
  teamPk,
  ticketPk,
  waiverPdfTicketSk,
} from '../../lib/dynamo/index.js';
import { renderPdf, type PdfBlock } from '../../lib/pdf.js';
import { getSignature } from './waiver-store.js';
import { loadMemberNames } from '../../lib/chat-member-names.js';

/** `TICKET#<id>` / `WAIVER_PDF`. */
type PdfTicketItem = {
  teamId: string;
  waiverId: string;
  memberId: string;
  issuedTo: string;
  ttl: number;
};

/** Ticket ids are 32 random bytes, base64url. */
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * Issues a link ticket for one signature's PDF.
 *
 * The caller's access to the signature is checked before this is called.
 *
 * @param input - The signature and the caller.
 * @returns The ticket and its lifetime in seconds.
 */
export const issueWaiverPdfTicket = async (input: {
  teamId: string;
  waiverId: string;
  memberId: string;
  userId: string;
}): Promise<{ ticket: string; expiresIn: number }> => {
  const ticket = randomBytes(32).toString('base64url');
  const item: PdfTicketItem = {
    teamId: input.teamId,
    waiverId: input.waiverId,
    memberId: input.memberId,
    issuedTo: input.userId,
    ttl: Math.floor(Date.now() / 1000) + WAIVER_PDF_TICKET_TTL_SECONDS,
  };
  await putItem({ [TABLE_PK]: ticketPk(ticket), [TABLE_SK]: waiverPdfTicketSk(), ...item });
  return { ticket, expiresIn: WAIVER_PDF_TICKET_TTL_SECONDS };
};

/**
 * Reads a link ticket. Expired rows are refused even before DynamoDB removes them.
 *
 * @param ticket - The id from the path.
 * @returns The signature it opens.
 * @throws `pdf_link_expired` for an unknown or expired ticket.
 */
export const readWaiverPdfTicket = async (ticket: string): Promise<PdfTicketItem> => {
  if (!TICKET_PATTERN.test(ticket)) throw new Error('pdf_link_expired');
  const item = await getItem<PdfTicketItem>(ticketPk(ticket), waiverPdfTicketSk());
  if (item === undefined || item.ttl <= Math.floor(Date.now() / 1000)) throw new Error('pdf_link_expired');
  return item;
};

/** How the signature was given, in a sentence for the record. */
const methodText = (signature: WaiverSignature): string => {
  if (signature.method === 'paper') return 'Paper form, recorded in GamePlan by team staff';
  return signature.relationship === 'guardian'
    ? 'Signed electronically in GamePlan by a parent or guardian'
    : 'Signed electronically in GamePlan by the member';
};

/**
 * The PDF blocks for one signature.
 *
 * @param signature - The signature and its text.
 * @param names - Team, member, and (for paper forms) the staff member's name.
 * @param now - When the copy is made.
 * @returns The document.
 */
export const waiverPdfDocument = (
  signature: WaiverSignature,
  names: { teamName?: string; memberName?: string; recordedByName?: string },
  now: Date,
): { title: string; blocks: PdfBlock[]; footer: string } => {
  const record: [string, string][] = [
    ['Signed by', signature.signerName],
    ['For', names.memberName ?? signature.memberId],
    ['Signed at', `${signature.signedAt.replace('T', ' ').replace(/\.\d+Z$/u, ' UTC').replace(/Z$/u, ' UTC')}`],
    ['How', methodText(signature)],
    ...(signature.method === 'paper' && names.recordedByName !== undefined
      ? ([['Recorded by', names.recordedByName]] as [string, string][])
      : []),
    ['Account', signature.signedBy],
    ['Version', String(signature.version)],
    ['Text SHA-256', signature.textHash],
  ];
  return {
    title: signature.title,
    footer: `${signature.title} - ${names.memberName ?? signature.memberId}`,
    blocks: [
      { text: signature.title, bold: true, size: 18 },
      ...(names.teamName !== undefined ? [{ text: names.teamName, muted: true, gapBefore: 2 }] : []),
      { text: signature.body, gapBefore: 14 },
      { text: 'Signature record', bold: true, size: 13, gapBefore: 18, ruleBefore: true },
      ...record.map(([label, value], index) => ({ text: `${label}: ${value}`, gapBefore: index === 0 ? 6 : 2 })),
      {
        text:
          `Copy made by GamePlan on ${now.toISOString().slice(0, 10)}. The text above is the exact version that was signed. ` +
          'The hash is SHA-256 of the title, a blank line, and the text, and matches the record the team keeps.',
        size: 8,
        muted: true,
        gapBefore: 16,
      },
    ],
  };
};

/**
 * Renders one signature as a PDF.
 *
 * @param ticket - The stored ticket.
 * @param now - When the copy is made.
 * @returns A file name and the PDF bytes.
 * @throws `signature_not_found`.
 */
export const renderWaiverPdf = async (
  ticket: Pick<PdfTicketItem, 'teamId' | 'waiverId' | 'memberId'>,
  now: Date = new Date(),
): Promise<{ fileName: string; bytes: Buffer }> => {
  const signature = await getSignature(ticket.teamId, ticket.waiverId, ticket.memberId);
  const [team, names] = await Promise.all([
    getItem<{ name?: string }>(teamPk(ticket.teamId), teamMetaSk()),
    loadMemberNames(
      signature.method === 'paper' ? [signature.memberId, signature.signedBy] : [signature.memberId],
    ),
  ]);
  const doc = waiverPdfDocument(
    signature,
    {
      ...(team?.name !== undefined ? { teamName: team.name } : {}),
      ...(names[signature.memberId] !== undefined ? { memberName: names[signature.memberId] } : {}),
      ...(signature.method === 'paper' && names[signature.signedBy] !== undefined
        ? { recordedByName: names[signature.signedBy] }
        : {}),
    },
    now,
  );
  const slug = `${signature.title}-${doc.footer.split(' - ')[1] ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80);
  return { fileName: `${slug.length > 0 ? slug : 'waiver'}.pdf`, bytes: renderPdf(doc, now) };
};

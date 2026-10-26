/**
 * Opens a signed waiver as a PDF.
 *
 * The API hands out a five-minute ticket, because a browser or PDF viewer
 * cannot send the sign-in token. On the website the file downloads; in the
 * app it opens in the in-app browser, which can save or share it.
 */

import { Platform } from 'react-native';
import type { ApiClient } from './api';
import { config } from './config';
import { openApiPage } from './open-link';

/** Which signature to export. */
export type WaiverPdfTarget = { teamId: string; waiverId: string; memberId: string };

/**
 * The PDF URL for a ticket.
 *
 * @param ticket - The ticket from `createWaiverPdfLink`.
 * @param apiBaseUrl - The API base the app was built with.
 * @returns The URL to open.
 */
export const waiverPdfUrl = (ticket: string, apiBaseUrl: string = config.apiBaseUrl): string =>
  `${apiBaseUrl}/teams/waiver-pdf/${encodeURIComponent(ticket)}`;

/**
 * Reads the file name from a `Content-Disposition` header.
 *
 * @param header - The header, if any.
 * @returns The quoted file name, or `waiver.pdf`.
 */
export const pdfFileName = (header: string | null): string => /filename="([^"]+)"/u.exec(header ?? '')?.[1] ?? 'waiver.pdf';

/**
 * Downloads or opens the PDF of one signature.
 *
 * @param api - The signed-in client.
 * @param target - The signature.
 * @throws What the link request throws, or `pdf_failed` when the file cannot be fetched.
 */
export const openWaiverPdf = async (api: Pick<ApiClient, 'createWaiverPdfLink'>, target: WaiverPdfTarget): Promise<void> => {
  const { ticket } = await api.createWaiverPdfLink(target.teamId, target.waiverId, target.memberId);
  const url = waiverPdfUrl(ticket);
  if (Platform.OS !== 'web') {
    await openApiPage(url, config.apiBaseUrl);
    return;
  }
  // A new tab opened after an await is often blocked, so the website downloads the file instead.
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error('pdf_failed');
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = pdfFileName(response.headers.get('content-disposition'));
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
};

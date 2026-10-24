/**
 * Emails a support request to GamePlan through Amazon SES.
 *
 * `SUPPORT_EMAIL` is the inbox that receives requests and `SUPPORT_EMAIL_FROM`
 * is the verified address they are sent from. Without both, the route reports
 * `support_not_configured` and the app opens the person's own mail app.
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/** One support request, ready to send. */
export type SupportMail = {
  subject: string;
  message: string;
  /** The sender's account address. Support replies go here. */
  replyTo: string;
  displayName: string;
  userId: string;
};

let ses: SESv2Client | undefined;

/**
 * Whether this deployment has an inbox and a sending address.
 *
 * @returns True when support mail can be sent.
 */
export const supportMailConfigured = (): boolean =>
  Boolean(process.env.SUPPORT_EMAIL?.trim() && process.env.SUPPORT_EMAIL_FROM?.trim());

/**
 * Collapses line breaks so a person's subject cannot add mail headers.
 *
 * @param subject - The subject the person typed.
 * @returns One line of text.
 */
export const oneLine = (subject: string): string => subject.replace(/[\r\n]+/gu, ' ').trim();

/**
 * Sends a support request as plain text, so nothing the person typed renders as HTML.
 *
 * @param mail - The request and who sent it.
 */
export const sendSupportMail = async (mail: SupportMail): Promise<void> => {
  const to = process.env.SUPPORT_EMAIL?.trim();
  const from = process.env.SUPPORT_EMAIL_FROM?.trim();
  if (!to || !from) throw new Error('support_not_configured');
  ses ??= new SESv2Client({});
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: `GamePlan support <${from}>`,
        Destination: { ToAddresses: [to] },
        ReplyToAddresses: [mail.replyTo],
        Content: {
          Simple: {
            Subject: { Data: `[Support] ${oneLine(mail.subject)}`, Charset: 'UTF-8' },
            Body: {
              Text: {
                Data: `From: ${mail.displayName} <${mail.replyTo}>\nUser: ${mail.userId}\n\n${mail.message}`,
                Charset: 'UTF-8',
              },
            },
          },
        },
      }),
    );
  } catch (error) {
    // The message and address are never logged.
    console.error(JSON.stringify({ message: 'support_send_failed', error: error instanceof Error ? error.name : 'unknown' }));
    throw new Error('support_send_failed');
  }
};

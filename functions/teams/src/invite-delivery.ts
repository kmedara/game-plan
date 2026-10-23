/**
 * Sends invite emails through Amazon SES and invite texts through AWS End User
 * Messaging SMS, from GamePlan's own address and number.
 *
 * `INVITE_EMAIL_FROM` is the sending address on the website host, verified in
 * SES. `SMS_ORIGINATION_IDENTITY` is the ARN of the registered toll-free number.
 * A channel without its variable reports `email_not_configured` or
 * `text_not_configured`, and the app falls back to the person's own mail or
 * messages app.
 */

import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { InviteEmail } from './invite-message.js';

/** An email to send. */
export type InviteEmailDelivery = InviteEmail & {
  to: string;
  /** Shown as "<name> via GamePlan". */
  inviterName: string;
  /** The inviter's address, so a reply reaches them. */
  replyTo?: string;
};

/** The two ways GamePlan sends an invite. */
export type InviteDelivery = {
  /** Whether the channel has an address or number to send from. */
  configured: (channel: 'email' | 'text') => boolean;
  email: (input: InviteEmailDelivery) => Promise<void>;
  text: (input: { to: string; body: string }) => Promise<void>;
};

let ses: SESv2Client | undefined;
let sms: PinpointSMSVoiceV2Client | undefined;

/**
 * Encodes a display name as a MIME encoded-word, so any characters are safe in
 * the From header.
 *
 * @param name - The display name.
 * @returns The encoded word.
 */
export const encodedDisplayName = (name: string): string =>
  `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`;

/**
 * Maps a provider error to a stable code. The recipient is never logged.
 *
 * @param channel - Which channel failed.
 * @param error - The thrown value.
 * @returns The error to rethrow.
 */
const deliveryError = (channel: 'email' | 'text', error: unknown): Error => {
  const name = error instanceof Error ? error.name : 'unknown';
  const reason = (error as { Reason?: unknown } | undefined)?.Reason;
  if (channel === 'text' && reason === 'DESTINATION_PHONE_NUMBER_OPTED_OUT') {
    return new Error('recipient_opted_out');
  }
  console.error(JSON.stringify({ message: 'invite_send_failed', channel, error: name, reason }));
  return new Error('invite_send_failed');
};

/** SES and SMS delivery configured from the environment. */
export const awsInviteDelivery: InviteDelivery = {
  configured: (channel) =>
    (channel === 'email' ? process.env.INVITE_EMAIL_FROM : process.env.SMS_ORIGINATION_IDENTITY)?.trim()
      ? true
      : false,
  email: async (input) => {
    const from = process.env.INVITE_EMAIL_FROM?.trim();
    if (!from) throw new Error('email_not_configured');
    ses ??= new SESv2Client({});
    try {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: `${encodedDisplayName(`${input.inviterName} via GamePlan`)} <${from}>`,
          Destination: { ToAddresses: [input.to] },
          ...(input.replyTo === undefined ? {} : { ReplyToAddresses: [input.replyTo] }),
          Content: {
            Simple: {
              Subject: { Data: input.subject, Charset: 'UTF-8' },
              Body: {
                Text: { Data: input.text, Charset: 'UTF-8' },
                Html: { Data: input.html, Charset: 'UTF-8' },
              },
            },
          },
        }),
      );
    } catch (error) {
      throw deliveryError('email', error);
    }
  },
  text: async (input) => {
    const origination = process.env.SMS_ORIGINATION_IDENTITY?.trim();
    if (!origination) throw new Error('text_not_configured');
    sms ??= new PinpointSMSVoiceV2Client({});
    try {
      await sms.send(
        new SendTextMessageCommand({
          DestinationPhoneNumber: input.to,
          OriginationIdentity: origination,
          MessageBody: input.body,
          MessageType: 'TRANSACTIONAL',
        }),
      );
    } catch (error) {
      throw deliveryError('text', error);
    }
  },
};

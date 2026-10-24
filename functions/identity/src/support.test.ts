/**
 * `POST /identity/support` with SES and the profile store replaced.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';

const sent: Array<Record<string, unknown>> = [];
let failSend = false;

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    async send(command: { input: Record<string, unknown> }): Promise<void> {
      if (failSend) throw Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' });
      sent.push(command.input);
    }
  },
  SendEmailCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock('../../lib/auth/profile.js', () => ({
  getProfile: async (userId: string) =>
    userId === 'u1' ? { userId: 'u1', email: 'ada@example.com', displayName: 'Ada', accountKind: 'adult' } : undefined,
}));

const { handler } = await import('./handler.js');

const post = (body: unknown, userId = 'u1'): Promise<{ statusCode?: number; body?: string }> =>
  handler({
    version: '2.0',
    rawPath: '/identity/support',
    headers: { authorization: `Bearer ${issueLocalTokens(userId, `${userId}@example.com`).accessToken}` },
    body: JSON.stringify(body),
    requestContext: { http: { method: 'POST', path: '/identity/support' } },
  } as unknown as APIGatewayProxyEventV2) as Promise<{ statusCode?: number; body?: string }>;

describe('support requests', () => {
  beforeEach(() => {
    process.env.SUPPORT_EMAIL = 'help@example.com';
    process.env.SUPPORT_EMAIL_FROM = 'support@example.com';
    sent.length = 0;
    failSend = false;
  });
  afterEach(() => {
    delete process.env.SUPPORT_EMAIL;
    delete process.env.SUPPORT_EMAIL_FROM;
  });

  it('emails support as plain text with replies going to the caller', async () => {
    const result = await post({ subject: 'Broken\r\nBcc: x@evil.test', message: '  <b>Help</b>  ' });
    expect(result.statusCode).toBe(204);
    expect(sent).toHaveLength(1);
    const mail = sent[0] as {
      Destination: { ToAddresses: string[] };
      ReplyToAddresses: string[];
      FromEmailAddress: string;
      Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string }; Html?: unknown } } };
    };
    expect(mail.Destination.ToAddresses).toEqual(['help@example.com']);
    expect(mail.ReplyToAddresses).toEqual(['ada@example.com']);
    expect(mail.FromEmailAddress).toBe('GamePlan support <support@example.com>');
    expect(mail.Content.Simple.Subject.Data).toBe('[Support] Broken Bcc: x@evil.test');
    expect(mail.Content.Simple.Body.Html).toBeUndefined();
    expect(mail.Content.Simple.Body.Text.Data).toContain('From: Ada <ada@example.com>\nUser: u1\n\n<b>Help</b>');
  });

  it('refuses an empty message and a missing sign-in', async () => {
    expect((await post({ subject: 'Hi', message: '   ' })).statusCode).toBe(400);
    const anonymous = await handler({
      version: '2.0',
      rawPath: '/identity/support',
      headers: {},
      body: JSON.stringify({ subject: 'Hi', message: 'Hello' }),
      requestContext: { http: { method: 'POST', path: '/identity/support' } },
    } as unknown as APIGatewayProxyEventV2);
    expect((anonymous as { statusCode?: number }).statusCode).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('reports a deployment without an inbox, and a failed send', async () => {
    delete process.env.SUPPORT_EMAIL;
    const unconfigured = await post({ subject: 'Hi', message: 'Hello' });
    expect(unconfigured.statusCode).toBe(503);
    expect(JSON.parse(unconfigured.body ?? '')).toEqual({ error: 'support_not_configured' });

    process.env.SUPPORT_EMAIL = 'help@example.com';
    failSend = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await post({ subject: 'Hi', message: 'Hello' });
    expect(JSON.parse(failed.body ?? '')).toEqual({ error: 'support_send_failed' });
  });
});

/**
 * Invite email and text wording, and how user-entered names are cleaned.
 */

import { describe, expect, it } from 'vitest';
import { inviteEmail, inviteTextMessage, messageName } from './invite-message.js';

const base = {
  locale: 'en',
  inviterName: 'Coach Sam',
  teamName: 'Rockets',
  role: 'coach',
  code: 'ABC123',
  url: 'https://staging.example.com/invite/ABC123',
} as const;

describe('invite messages', () => {
  it('keeps a name on one line and bounds its length', () => {
    expect(messageName('Rock\nets\u0000 \t FC')).toBe('Rock ets FC');
    const long = messageName('x'.repeat(200));
    expect(long.length).toBe(60);
    expect(long.endsWith('…')).toBe(true);
  });

  it('brands the text and says how to opt out', () => {
    expect(inviteTextMessage(base)).toBe(
      'GamePlan: Coach Sam invited you to join Rockets as Coach. Code ABC123: https://staging.example.com/invite/ABC123 Reply STOP to opt out.',
    );
  });

  it('escapes names in the HTML email but not the plain text', () => {
    const email = inviteEmail({ ...base, teamName: '<b>Rockets</b> & Co' });
    expect(email.subject).toBe('Coach Sam invited you to join <b>Rockets</b> & Co on GamePlan');
    expect(email.text).toContain('join <b>Rockets</b> & Co on GamePlan as Coach.');
    expect(email.html).toContain('join &lt;b&gt;Rockets&lt;/b&gt; &amp; Co on GamePlan');
    expect(email.html).not.toContain('<b>Rockets');
    expect(email.html).toContain('href="https://staging.example.com/invite/ABC123"');
  });

  it('writes Spanish when asked', () => {
    const email = inviteEmail({ ...base, locale: 'es', role: 'parent' });
    expect(email.subject).toBe('Coach Sam te invitó a unirte a Rockets en GamePlan');
    expect(email.text).toContain('como Padre/madre.');
  });
});

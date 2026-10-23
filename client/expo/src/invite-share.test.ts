/**
 * Invite message links for email and text.
 */

import {
  inviteMessageBody,
  invitePageUrl,
  inviteSiteOrigin,
  isEmailAddress,
  mailtoInviteUrl,
  smsBodySeparator,
  smsInviteUrl,
} from './invite-share';

describe('invite share links', () => {
  it('accepts a single email address', () => {
    expect(isEmailAddress('coach@example.com')).toBe(true);
    expect(isEmailAddress('  coach@example.com  ')).toBe(true);
    expect(isEmailAddress('not an email')).toBe(false);
    expect(isEmailAddress('a@b')).toBe(false);
  });

  it('builds an invite page, a mailto link, and an sms link', () => {
    expect(invitePageUrl('https://app.example.com/', 'ab/cd')).toBe(
      'https://app.example.com/invite/ab%2Fcd',
    );
    const body = inviteMessageBody({
      intro: 'Join Rockets as Player.',
      codeLabel: 'Invite code',
      code: 'abc',
      url: 'https://app.example.com/invite/abc',
    });
    expect(body).toBe(
      'Join Rockets as Player.\nInvite code: abc\nhttps://app.example.com/invite/abc',
    );
    expect(mailtoInviteUrl('a@b.co', 'Join', 'code: abc')).toBe(
      'mailto:a@b.co?subject=Join&body=code%3A%20abc',
    );
    expect(smsInviteUrl('+12025550123', 'code abc', '?')).toBe('sms:+12025550123?body=code%20abc');
    expect(smsInviteUrl('+12025550123', 'code abc', '&')).toBe('sms:+12025550123&body=code%20abc');
  });

  it('links the phone apps to the website host that serves the API', () => {
    expect(inviteSiteOrigin('https://app.example.com', 'https://other.example.com/api')).toBe(
      'https://app.example.com',
    );
    expect(inviteSiteOrigin('', 'https://app.example.com/api/')).toBe('https://app.example.com');
    expect(inviteSiteOrigin('', 'https://api.example.com')).toBeUndefined();
    expect(inviteSiteOrigin('', 'not a url')).toBeUndefined();
  });

  it('uses an ampersand body on iPhone', () => {
    expect(smsBodySeparator('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('&');
    expect(smsBodySeparator('Mozilla/5.0 (Linux; Android 14)')).toBe('?');
  });
});
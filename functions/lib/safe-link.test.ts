import { isSafeLink } from '@gameplan/rules';
import { describe, expect, it } from 'vitest';

describe('isSafeLink', () => {
  it('allows web, mail, phone, text, and calendar links', () => {
    expect(isSafeLink('https://example.com/a?b=c')).toBe(true);
    expect(isSafeLink('mailto:coach@example.com')).toBe(true);
    expect(isSafeLink('tel:+12025550123')).toBe(true);
    expect(isSafeLink('sms:+12025550123?body=hi')).toBe(true);
    expect(isSafeLink('webcal://example.com/feed.ics')).toBe(true);
  });

  it('rejects script, data, plain http, and relative links', () => {
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(isSafeLink(' JavaScript:alert(1)')).toBe(false);
    expect(isSafeLink('java\tscript:alert(1)')).toBe(false);
    expect(isSafeLink('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeLink('http://example.com')).toBe(false);
    expect(isSafeLink('/teams')).toBe(false);
    expect(isSafeLink('')).toBe(false);
  });

  it('narrows to the schemes a caller passes', () => {
    expect(isSafeLink('https://checkout.stripe.com/c/pay', ['https:'])).toBe(true);
    expect(isSafeLink('mailto:coach@example.com', ['https:'])).toBe(false);
  });
});

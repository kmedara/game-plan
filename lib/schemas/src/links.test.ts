import { describe, expect, it } from 'vitest';
import { httpsUrlSchema, webcalUrlSchema } from './links.js';

describe('link schemas', () => {
  it('accepts an https link and rejects other schemes', () => {
    expect(httpsUrlSchema.safeParse('https://checkout.stripe.com/c/pay').success).toBe(true);
    expect(httpsUrlSchema.safeParse('http://example.com').success).toBe(false);
    expect(httpsUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(httpsUrlSchema.safeParse('data:text/html,hi').success).toBe(false);
    expect(httpsUrlSchema.safeParse('not a url').success).toBe(false);
  });

  it('accepts only webcal for calendar subscriptions', () => {
    expect(webcalUrlSchema.safeParse('webcal://example.com/feed.ics').success).toBe(true);
    expect(webcalUrlSchema.safeParse('https://example.com/feed.ics').success).toBe(false);
  });
});

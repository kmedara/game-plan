import { describe, expect, it } from 'vitest';
import { phoneNumberSchema, toE164Phone } from './phone.js';

describe('phone numbers', () => {
  it('accepts a US number and an international number', () => {
    expect(toE164Phone('(202) 555-0123')).toBe('+12025550123');
    expect(toE164Phone('+44 20 7183 8750')).toBe('+442071838750');
    expect(phoneNumberSchema.parse('2025550123')).toBe('2025550123');
  });

  it('rejects a number that is too short', () => {
    expect(toE164Phone('1234567')).toBeUndefined();
    expect(phoneNumberSchema.safeParse('1234567').success).toBe(false);
  });
});

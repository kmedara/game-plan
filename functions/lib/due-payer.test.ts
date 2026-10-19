/**
 * Unit tests for who may pay a member's due.
 */

import { describe, expect, it } from 'vitest';
import { canPayDue, payerIdsForDue } from '@gameplan/rules';

describe('due payer rules', () => {
  it('lets an adult pay their own due', () => {
    const adult = { userId: 'a', accountKind: 'adult' as const, guardianIds: ['g'] };
    expect(payerIdsForDue(adult)).toEqual(['a']);
    expect(canPayDue('a', adult)).toBe(true);
    expect(canPayDue('g', adult)).toBe(false);
  });

  it("sends a minor's due to their guardians, never the minor", () => {
    const minor = { userId: 'm', accountKind: 'minor' as const, guardianIds: ['g1', 'g2', 'g1'] };
    expect(payerIdsForDue(minor)).toEqual(['g1', 'g2']);
    expect(canPayDue('m', minor)).toBe(false);
    expect(canPayDue('g2', minor)).toBe(true);
  });

  it('has no in-app payer for a minor with no guardian', () => {
    expect(payerIdsForDue({ userId: 'm', accountKind: 'minor' })).toEqual([]);
  });
});

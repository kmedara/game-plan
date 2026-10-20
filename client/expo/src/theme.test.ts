/**
 * Event type colors stay distinct and readable.
 */

import { EVENT_TYPES } from '@gameplan/types';
import { colors, contrastRatio, EVENT_TYPE_COLORS } from './theme';

describe('EVENT_TYPE_COLORS', () => {
  it('gives every type its own color, apart from the brand green and error red', () => {
    const shades = EVENT_TYPES.map((type) => EVENT_TYPE_COLORS[type]);
    expect(new Set(shades).size).toBe(EVENT_TYPES.length);
    expect(shades).not.toContain(colors.field);
    expect(shades).not.toContain(colors.danger);
  });

  it('keeps at least 3:1 contrast on the row and card backgrounds', () => {
    for (const type of EVENT_TYPES) {
      expect(contrastRatio(EVENT_TYPE_COLORS[type], colors.inset)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(EVENT_TYPE_COLORS[type], colors.paper)).toBeGreaterThanOrEqual(3);
    }
  });
});

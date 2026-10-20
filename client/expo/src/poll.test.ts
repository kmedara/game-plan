/**
 * Tapping poll options picks, switches, and takes back choices.
 */

import { nextChoices } from './poll';

describe('nextChoices', () => {
  it('switches a single-choice vote and takes it back on a second tap', () => {
    expect(nextChoices([], 'o1', false)).toEqual(['o1']);
    expect(nextChoices(['o1'], 'o2', false)).toEqual(['o2']);
    expect(nextChoices(['o2'], 'o2', false)).toEqual([]);
  });

  it('adds and removes choices on a multiple-choice poll', () => {
    expect(nextChoices(['o1'], 'o2', true)).toEqual(['o1', 'o2']);
    expect(nextChoices(['o1', 'o2'], 'o1', true)).toEqual(['o2']);
  });
});

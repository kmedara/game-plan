/**
 * Teammate suggestions: matching, the one-team rule, and labels.
 */

import { parseTeammateChoiceId, searchTeammates, teammateChoiceId } from './teammate-search';

const groups = [
  {
    team: { teamId: 'hawks', name: 'Hawks' },
    members: [{ userId: 'sam', displayName: 'Sam Lowe' }, { userId: 'alex', displayName: 'Alex Lovelace' }],
  },
  { team: { teamId: 'owls', name: 'Owls' }, members: [{ userId: 'jo', displayName: 'Jo' }, { userId: 'anon' }] },
];

const search = (overrides: Partial<Parameters<typeof searchTeammates>[0]> = {}) =>
  searchTeammates({
    groups,
    pickedTeamId: undefined,
    pickedIds: [],
    query: '',
    showTeam: false,
    unknownName: 'Unknown',
    callerIsAdult: false,
    noGuardianReason: 'No guardian',
    ...overrides,
  });

const minors = [
  {
    team: { teamId: 'u12', name: 'U12' },
    members: [
      { userId: 'kai', displayName: 'Kai', accountKind: 'minor' as const, hasGuardian: false },
      { userId: 'lee', displayName: 'Lee', accountKind: 'minor' as const, hasGuardian: true },
    ],
  },
];

describe('searchTeammates', () => {
  it('lists everyone by name for an empty query', () => {
    expect(search().map((choice) => choice.label)).toEqual(['Alex Lovelace', 'Jo', 'Sam Lowe', 'Unknown']);
  });

  it('matches the start of a first or last name, ignoring case', () => {
    expect(search({ query: ' LO' }).map((choice) => choice.label)).toEqual(['Alex Lovelace', 'Sam Lowe']);
    expect(search({ query: 'alex lov' }).map((choice) => choice.label)).toEqual(['Alex Lovelace']);
    expect(search({ query: 'ace' })).toEqual([]);
  });

  it('offers only the picked team and leaves out people already picked', () => {
    expect(search({ pickedTeamId: 'hawks', pickedIds: ['sam'] }).map((choice) => choice.label)).toEqual([
      'Alex Lovelace',
    ]);
  });

  it('blocks a minor with no guardian when an adult starts the chat', () => {
    expect(search({ groups: minors, callerIsAdult: true }).map((choice) => choice.disabledReason)).toEqual([
      'No guardian',
      undefined,
    ]);
  });

  it('lets a minor pick a teammate who has no guardian', () => {
    expect(search({ groups: minors }).every((choice) => choice.disabledReason === undefined)).toBe(true);
  });

  it('adds the team to the label when asked', () => {
    expect(search({ query: 'jo', showTeam: true })).toEqual([{ id: teammateChoiceId('owls', 'jo'), label: 'Jo · Owls' }]);
  });
});

describe('teammateChoiceId', () => {
  it('reads back the team and member', () => {
    expect(parseTeammateChoiceId(teammateChoiceId('hawks', 'sam'))).toEqual({ teamId: 'hawks', userId: 'sam' });
  });
});

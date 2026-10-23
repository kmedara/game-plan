/**
 * Separates a club's games from shared fixtures.
 *
 * Schedule unlinks one fixture at a time. Identity releases every fixture of a
 * team it deletes. Both go through here, so the other club's game is changed
 * the same way: it keeps its start, venue, and opponent name, and loses the link.
 */

import {
  FIXTURE_INVITE_SK_PREFIX,
  FIXTURE_LINK_SK_PREFIX,
  deleteItem,
  eventSk,
  fixtureInviteSk,
  fixtureLinkSk,
  fixtureMetaSk,
  fixturePk,
  getItem,
  putItem,
  queryBySkPrefix,
  teamPk,
} from './dynamo/index.js';
import { dissolveFixtureChat } from './fixture-chat.js';

/** The parts of `FIXTURE#id` / `META` a release needs. */
type FixtureMeta = {
  homeTeamId?: string;
  awayTeamId?: string;
  homeEventId?: string;
  awayEventId?: string;
  proposerTeamId?: string;
  inviteeTeamId?: string;
  chatId?: string;
};

/**
 * Removes the fixture link from one game.
 *
 * @param teamId - The game's team.
 * @param eventId - The game.
 * @returns `true` when the game had a link and was rewritten.
 */
export const dropEventFixtureId = async (teamId: string, eventId: string): Promise<boolean> => {
  const event = await getItem<Record<string, unknown>>(teamPk(teamId), eventSk(eventId));
  if (event?.fixtureId === undefined) return false;
  const { fixtureId: _fixtureId, ...rest } = event;
  await putItem({ ...rest, updatedAt: new Date().toISOString() });
  return true;
};

/**
 * Ends one fixture because `teamId` is going away.
 *
 * The other club's game drops the link, its link or proposal row goes, the
 * staff thread closes (its messages stay), and the fixture row is deleted.
 * The leaving team's own rows are left for its caller to remove.
 *
 * @param fixtureId - The fixture.
 * @param teamId - The team that is leaving it.
 */
const releaseFixture = async (fixtureId: string, teamId: string): Promise<void> => {
  const fixture = await getItem<FixtureMeta>(fixturePk(fixtureId), fixtureMetaSk());
  if (fixture === undefined) return;
  const sides: [string | undefined, string | undefined][] = [
    [fixture.homeTeamId, fixture.homeEventId],
    [fixture.awayTeamId, fixture.awayEventId],
  ];
  for (const [otherTeamId, eventId] of sides) {
    if (otherTeamId !== undefined && otherTeamId !== teamId && eventId !== undefined) {
      await dropEventFixtureId(otherTeamId, eventId);
    }
  }
  const others = new Set(
    [fixture.homeTeamId, fixture.awayTeamId, fixture.proposerTeamId, fixture.inviteeTeamId].filter(
      (id): id is string => id !== undefined && id !== teamId,
    ),
  );
  for (const otherTeamId of others) {
    await deleteItem(teamPk(otherTeamId), fixtureLinkSk(fixtureId));
    await deleteItem(teamPk(otherTeamId), fixtureInviteSk(fixtureId));
  }
  if (fixture.chatId !== undefined) await dissolveFixtureChat(fixture.chatId);
  await deleteItem(fixturePk(fixtureId), fixtureMetaSk());
};

/**
 * Ends every fixture a team shares, proposed or linked, in either direction.
 *
 * @param teamId - The team that is going away.
 */
export const releaseTeamFixtures = async (teamId: string): Promise<void> => {
  const rows = [
    ...(await queryBySkPrefix<{ fixtureId?: string }>(teamPk(teamId), FIXTURE_LINK_SK_PREFIX)),
    ...(await queryBySkPrefix<{ fixtureId?: string }>(teamPk(teamId), FIXTURE_INVITE_SK_PREFIX)),
  ];
  const fixtureIds = new Set(rows.map((row) => row.fixtureId).filter((id): id is string => id !== undefined));
  for (const fixtureId of fixtureIds) await releaseFixture(fixtureId, teamId);
};

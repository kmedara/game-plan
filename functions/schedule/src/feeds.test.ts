/**
 * Calendar feed links and the iCalendar body they serve.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { TABLE_PK, TABLE_SK, childSk, eventSk, teamMetaSk, teamPk, userPk, userTeamSk } from '../../lib/dynamo/keys.js';
import { buildCalendar, escapeText, foldLine } from './ical.js';

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);
vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (): Promise<void> => undefined,
  resetFanoutSqsClient: (): void => undefined,
}));

const { handler } = await import('./handler.js');

const httpEvent = (method: string, path: string, authorization?: string, query?: Record<string, string>) =>
  ({
    version: '2.0',
    rawPath: path,
    headers: authorization === undefined ? {} : { authorization },
    queryStringParameters: query,
    requestContext: { http: { method, path } },
  }) as unknown as APIGatewayProxyEventV2;

const call = (event: APIGatewayProxyEventV2) => handler(event) as Promise<APIGatewayProxyStructuredResultV2>;

const authFor = (userId: string): string => `Bearer ${issueLocalTokens(userId, `${userId}@example.com`).accessToken}`;

const seedTeam = (teamId: string, name: string, memberIds: string[]): void => {
  memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMetaSk(), teamId, name, timeZone: 'America/Los_Angeles' });
  for (const userId of memberIds) {
    memoryTable.put({ [TABLE_PK]: userPk(userId), [TABLE_SK]: userTeamSk(teamId), teamId, role: 'player' });
  }
};

const seedEvent = (teamId: string, fields: Record<string, unknown>): void => {
  const eventId = randomUUID();
  memoryTable.put({
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: eventSk(eventId),
    eventId,
    teamId,
    eventType: 'practice',
    createdBy: 'coach',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...fields,
  });
};

const feedPath = (url: string): string => new URL(url).pathname.replace(/^\/api/u, '');

describe('iCalendar text', () => {
  it('escapes separators and folds long lines without splitting a character', () => {
    expect(escapeText('Field 2; north, by the café\nbring water')).toBe('Field 2\\; north\\, by the café\\nbring water');
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}`);
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').slice(1).every((line) => line.startsWith(' '))).toBe(true);
  });

  it('writes one event per date with a stable id and a default hour length', () => {
    const body = buildCalendar({
      name: 'GamePlan',
      now: new Date('2026-10-19T00:00:00.000Z'),
      occurrences: [
        {
          teamId: 't1',
          teamName: 'Hawks',
          eventId: 'e1',
          eventType: 'game',
          title: 'League game',
          opponentName: 'Owls',
          side: 'away',
          startsAt: '2026-10-21T02:00:00.000Z',
          recurring: false,
          rsvps: [],
        },
      ],
    });
    expect(body).toContain('UID:t1-e1-20261021T020000Z@gameplan');
    expect(body).toContain('DTSTART:20261021T020000Z\r\nDTEND:20261021T030000Z');
    expect(body).toContain('SUMMARY:Hawks: Away vs Owls');
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

describe('calendar feed routes', () => {
  beforeEach(() => memoryTable.clear());

  it('serves the owner’s teams and their child’s teams, without cancelled dates', async () => {
    seedTeam('hawks', 'Hawks', ['parent']);
    seedTeam('owls', 'Owls', ['kid']);
    seedTeam('other', 'Other', ['someone']);
    memoryTable.put({ [TABLE_PK]: userPk('parent'), [TABLE_SK]: childSk('kid'), minorId: 'kid', adultId: 'parent' });
    const now = Date.now();
    const inDays = (days: number) => new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
    seedEvent('hawks', { title: 'Hawks practice', eventType: 'practice', startsAt: inDays(3), exdates: [] });
    seedEvent('owls', { title: 'Owls game', eventType: 'game', startsAt: inDays(5), location: 'Field 2' });
    seedEvent('other', { title: 'Not mine', startsAt: inDays(4) });
    const cancelled = inDays(6);
    seedEvent('hawks', { title: 'Cancelled scrimmage', startsAt: cancelled, exdates: [cancelled] });

    const links = await call(httpEvent('GET', '/schedule/feed', authFor('parent')));
    expect(links.statusCode).toBe(200);
    const { url, webcalUrl } = JSON.parse(String(links.body)) as { url: string; webcalUrl: string };
    expect(webcalUrl.startsWith('webcal://')).toBe(true);
    const again = JSON.parse(String((await call(httpEvent('GET', '/schedule/feed', authFor('parent')))).body)) as { url: string };
    expect(again.url).toBe(url);

    const feed = await call(httpEvent('GET', feedPath(url)));
    expect(feed.statusCode).toBe(200);
    expect(feed.headers?.['content-type']).toContain('text/calendar');
    const body = String(feed.body);
    expect(body).toContain('SUMMARY:Hawks: Practice');
    expect(body).toContain('SUMMARY:Owls: Game');
    expect(body).toContain('LOCATION:Field 2');
    expect(body).not.toContain('Not mine');
    expect(body).not.toContain('Cancelled scrimmage');

    const narrowed = await call(httpEvent('GET', feedPath(url), undefined, { teams: 'owls' }));
    expect(String(narrowed.body)).not.toContain('Hawks practice');
  });

  it('stops serving a link once it is reset, and answers 404 for any unknown link', async () => {
    seedTeam('hawks', 'Hawks', ['parent']);
    const first = JSON.parse(String((await call(httpEvent('GET', '/schedule/feed', authFor('parent')))).body)) as { url: string };
    const rotated = JSON.parse(String((await call(httpEvent('POST', '/schedule/feed/rotate', authFor('parent')))).body)) as {
      url: string;
    };
    expect(rotated.url).not.toBe(first.url);
    expect((await call(httpEvent('GET', feedPath(first.url)))).statusCode).toBe(404);
    expect((await call(httpEvent('GET', feedPath(rotated.url)))).statusCode).toBe(200);
    expect((await call(httpEvent('GET', '/schedule/feeds/short.ics'))).statusCode).toBe(404);
    expect((await call(httpEvent('GET', '/schedule/feeds/AAAAAAAAAAAAAAAAAAAAAAAA.ics'))).statusCode).toBe(404);
  });
});

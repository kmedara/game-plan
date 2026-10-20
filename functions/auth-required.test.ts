/**
 * Every protected HTTP route rejects a caller without a valid access token.
 *
 * Function URLs do not check the Cognito token, so each route must. The
 * inventory test fails when a handler dispatches to a route this file does not
 * list, so a new route cannot skip the check unnoticed.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler as billing } from './billing/src/handler.js';
import { handler as chat } from './chat/src/handler.js';
import { handler as identity } from './identity/src/handler.js';
import { handler as media } from './media/src/handler.js';
import { handler as payments } from './payments/src/handler.js';
import { handler as places } from './places/src/handler.js';
import { handler as schedule } from './schedule/src/handler.js';
import { handler as teams } from './teams/src/handler.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type HttpHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;

/** One dispatched route: the handler function it reaches, and a request that reaches it. */
type RouteCase = { route: string; method: Method; path: string; query?: string };

const handlers = { identity, teams, schedule, chat, media, places, payments, billing } as Record<
  string,
  HttpHandler
>;

/** Routes that must answer `401` without a token. */
const PROTECTED: Record<string, RouteCase[]> = {
  identity: [
    { route: 'handleMe', method: 'GET', path: '/identity/me' },
    { route: 'handleSocketTicket', method: 'POST', path: '/identity/socket-ticket' },
    { route: 'handleCompleteProfile', method: 'POST', path: '/identity/profile/complete' },
    { route: 'handleCreateGuardianInvite', method: 'POST', path: '/identity/guardians' },
    { route: 'handleAcceptGuardianInvite', method: 'POST', path: '/identity/guardians/code-1/accept' },
    { route: 'handleRemoveGuardianLink', method: 'DELETE', path: '/identity/guardians/user-2' },
    { route: 'handleUpdateProfile', method: 'PATCH', path: '/identity/profile' },
    { route: 'handleGetPreferences', method: 'GET', path: '/identity/me/preferences' },
    { route: 'handleUpdatePreferences', method: 'PATCH', path: '/identity/me/preferences' },
    { route: 'handleListMedical', method: 'GET', path: '/identity/medical' },
    { route: 'handlePutMedical', method: 'PUT', path: '/identity/medical/user-2' },
  ],
  teams: [
    { route: 'handleCreateTeam', method: 'POST', path: '/teams' },
    { route: 'handleListTeams', method: 'GET', path: '/teams' },
    { route: 'handleSearchDirectory', method: 'GET', path: '/teams/directory', query: 'q=pigs' },
    { route: 'handleGetInvite', method: 'GET', path: '/teams/invite/code-1' },
    { route: 'handleAcceptInvite', method: 'POST', path: '/teams/invite/code-1/accept' },
    { route: 'handleGetTeam', method: 'GET', path: '/teams/team-1' },
    { route: 'handleUpdateTeam', method: 'PATCH', path: '/teams/team-1' },
    { route: 'handleSetPositions', method: 'PUT', path: '/teams/team-1/positions' },
    { route: 'handleListMembers', method: 'GET', path: '/teams/team-1/members' },
    { route: 'handleGetMember', method: 'GET', path: '/teams/team-1/members/user-2' },
    { route: 'handleGetMemberMedical', method: 'GET', path: '/teams/team-1/members/user-2/medical' },
    { route: 'handleAssignRole', method: 'PATCH', path: '/teams/team-1/members/user-2' },
    { route: 'handleGetPermissions', method: 'GET', path: '/teams/team-1/permissions' },
    { route: 'handleUpdatePermissions', method: 'PUT', path: '/teams/team-1/permissions' },
    { route: 'handleCreateInvite', method: 'POST', path: '/teams/team-1/invites' },
    { route: 'handleListInvites', method: 'GET', path: '/teams/team-1/invites' },
    { route: 'handleDeleteInvite', method: 'DELETE', path: '/teams/team-1/invites/code-1' },
    { route: 'handleCreateJoinRequest', method: 'POST', path: '/teams/team-1/join-requests' },
    { route: 'handleListJoinRequests', method: 'GET', path: '/teams/team-1/join-requests' },
    { route: 'handleApproveJoinRequest', method: 'POST', path: '/teams/team-1/join-requests/req-1/approve' },
    { route: 'handleRejectJoinRequest', method: 'POST', path: '/teams/team-1/join-requests/req-1/reject' },
  ],
  schedule: [
    { route: 'handleGetFeed', method: 'GET', path: '/schedule/feed' },
    { route: 'handleGetSignups', method: 'GET', path: '/schedule/teams/team-1/signups' },
    { route: 'handlePutSignups', method: 'PUT', path: '/schedule/teams/team-1/signups' },
    { route: 'handleClaimSignup', method: 'PUT', path: '/schedule/teams/team-1/signups/claim' },
    { route: 'handleRotateFeed', method: 'POST', path: '/schedule/feed/rotate' },
    { route: 'handleListSchedule', method: 'GET', path: '/schedule/teams/team-1' },
    { route: 'handleCreateEvent', method: 'POST', path: '/schedule/teams/team-1/events' },
    { route: 'handleGetEvent', method: 'GET', path: '/schedule/teams/team-1/events/event-1' },
    { route: 'handleUpdateEvent', method: 'PATCH', path: '/schedule/teams/team-1/events/event-1' },
    { route: 'handleDeleteEvent', method: 'DELETE', path: '/schedule/teams/team-1/events/event-1' },
    { route: 'handleSaveOccurrence', method: 'POST', path: '/schedule/teams/team-1/events/event-1/occurrences' },
    { route: 'handleCancelOccurrence', method: 'DELETE', path: '/schedule/teams/team-1/events/event-1/occurrences' },
    { route: 'handleUpsertRsvp', method: 'PUT', path: '/schedule/teams/team-1/rsvps' },
    { route: 'handleGetLineup', method: 'GET', path: '/schedule/teams/team-1/lineup' },
    { route: 'handlePutLineup', method: 'PUT', path: '/schedule/teams/team-1/lineup' },
    { route: 'handleGetCarpool', method: 'GET', path: '/schedule/teams/team-1/carpool' },
    { route: 'handlePutCarpool', method: 'PUT', path: '/schedule/teams/team-1/carpool' },
    { route: 'handleClaimCarpool', method: 'PUT', path: '/schedule/teams/team-1/carpool/claim' },
    { route: 'handleListFixtures', method: 'GET', path: '/schedule/teams/team-1/fixtures' },
    { route: 'handleProposeFixture', method: 'POST', path: '/schedule/teams/team-1/events/event-1/fixture' },
    { route: 'handleAcceptFixture', method: 'POST', path: '/schedule/fixtures/fixture-1/accept' },
    { route: 'handleDeclineFixture', method: 'POST', path: '/schedule/fixtures/fixture-1/decline' },
    { route: 'handleUpdateFixture', method: 'PATCH', path: '/schedule/fixtures/fixture-1' },
    { route: 'handleUnlinkFixture', method: 'DELETE', path: '/schedule/fixtures/fixture-1' },
  ],
  chat: [
    { route: 'handleListChats', method: 'GET', path: '/chat' },
    { route: 'handleCreateTeamChannel', method: 'POST', path: '/chat/channels' },
    { route: 'handleCreatePrivateChat', method: 'POST', path: '/chat/private' },
    { route: 'handleSearchUsers', method: 'GET', path: '/chat/users/search', query: 'q=al' },
    { route: 'handleListMessages', method: 'GET', path: '/chat/chat-1/messages' },
    { route: 'handleSendMessage', method: 'POST', path: '/chat/chat-1/messages' },
    { route: 'handleCreatePoll', method: 'POST', path: '/chat/chat-1/polls' },
    { route: 'handleVotePoll', method: 'PUT', path: '/chat/chat-1/polls/message-1/vote' },
  ],
  media: [
    { route: 'handlePresignUpload', method: 'POST', path: '/media/presign-upload' },
    { route: 'handlePresignDownload', method: 'GET', path: '/media/presign-download', query: 'objectKey=users/u/a.png' },
    { route: 'handleRegisterDevice', method: 'PUT', path: '/media/devices/device-1' },
    { route: 'handleDeleteDevice', method: 'DELETE', path: '/media/devices/device-1' },
  ],
  places: [
    { route: 'handleAutocomplete', method: 'GET', path: '/places/autocomplete', query: 'q=field' },
    { route: 'handleResolve', method: 'GET', path: '/places/resolve', query: 'id=place-1' },
    { route: 'handleReverse', method: 'GET', path: '/places/reverse', query: 'lat=43&lng=-70' },
    { route: 'handleMapPreview', method: 'GET', path: '/places/map', query: 'lat=43&lng=-70' },
  ],
  payments: [
    { route: 'handleGetAccount', method: 'GET', path: '/payments/teams/team-1/account' },
    { route: 'handleCreateAccountLink', method: 'POST', path: '/payments/teams/team-1/account/link' },
    { route: 'handleListCharges', method: 'GET', path: '/payments/teams/team-1/charges' },
    { route: 'handleCreateCharge', method: 'POST', path: '/payments/teams/team-1/charges' },
    { route: 'handleGetCharge', method: 'GET', path: '/payments/teams/team-1/charges/charge-1' },
    { route: 'handleUpdateDue', method: 'PATCH', path: '/payments/teams/team-1/charges/charge-1/dues/user-1' },
    {
      route: 'handleCreateCheckout',
      method: 'POST',
      path: '/payments/teams/team-1/charges/charge-1/dues/user-1/checkout',
    },
    { route: 'handleListMyDues', method: 'GET', path: '/payments/me/dues' },
  ],
  billing: [
    { route: 'handleGetTeamBilling', method: 'GET', path: '/billing/teams/team-1' },
    { route: 'handleTeamCheckout', method: 'POST', path: '/billing/teams/team-1/checkout' },
    { route: 'handleTeamPortal', method: 'POST', path: '/billing/teams/team-1/portal' },
  ],
};

/** Routes that run before a session exists. Listed so the inventory can tell them apart. */
const PUBLIC: Record<string, string[]> = {
  identity: [
    'handleRegister',
    'handleResendConfirmation',
    'handleConfirmRegistration',
    'handleLogin',
    'handleRefresh',
    'handleLogout',
    'handleOAuthLogin',
    'handleOAuthCallback',
    'handleOAuthLogout',
    'handleOAuthExchange',
  ],
  // Answer `404` unless the local media store is on. Covered below.
  media: ['handleLocalPutObject', 'handleLocalGetObject'],
  // Stripe redirects the browser here and signs webhooks; neither carries a session.
  // Calendar apps fetch the feed with only the token in its URL.
  schedule: ['handleCalendarFeed'],
  payments: ['handlePaymentReturn', 'handleStripeWebhook'],
  billing: ['handleBillingReturn', 'handleBillingWebhook'],
};

/**
 * Builds a function URL event.
 *
 * @param route - The request to send.
 * @param authorization - Optional `Authorization` value.
 * @returns The event.
 */
const eventFor = (route: RouteCase, authorization?: string): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: route.path,
    rawQueryString: route.query ?? '',
    queryStringParameters:
      route.query === undefined ? undefined : Object.fromEntries(new URLSearchParams(route.query)),
    headers: {
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { authorization }),
    },
    requestContext: { http: { method: route.method, path: route.path } },
    body: route.method === 'GET' || route.method === 'DELETE' ? undefined : '{}',
    isBase64Encoded: false,
  }) as unknown as APIGatewayProxyEventV2;

const protectedCases = Object.entries(PROTECTED).flatMap(([area, routes]) =>
  routes.map((route) => [area, route.method, route.path, route] as const),
);

describe('protected routes', () => {
  it.each(protectedCases)('%s %s %s answers 401 without a token', async (area, _m, _p, route) => {
    const result = await handlers[area]!(eventFor(route));
    expect(result.statusCode).toBe(401);
  });

  it.each(protectedCases)('%s %s %s answers 401 with a forged token', async (area, _m, _p, route) => {
    const result = await handlers[area]!(eventFor(route, 'Bearer not.a.jwt'));
    expect(result.statusCode).toBe(401);
  });
});

describe('local-only media routes', () => {
  it.each(['PUT', 'GET'] as const)('%s /media/local-objects answers 404 when deployed', async (method) => {
    const previous = { MEDIA_LOCAL: process.env.MEDIA_LOCAL, DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT };
    delete process.env.MEDIA_LOCAL;
    delete process.env.DYNAMODB_ENDPOINT;
    try {
      const result = await media(eventFor({ route: '', method, path: '/media/local-objects/users/u/a.png' }));
      expect(result.statusCode).toBe(404);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value !== undefined) process.env[key] = value;
      }
    }
  });
});

describe('route inventory', () => {
  const root = path.dirname(fileURLToPath(import.meta.url));

  it.each(Object.keys(handlers))('%s lists every dispatched route', (area) => {
    const source = readFileSync(path.join(root, area, 'src', 'routes', 'index.ts'), 'utf8');
    const list = source.match(/export const httpRoutes[^\[]*\[([\s\S]*?)\];/u)?.[1] ?? '';
    const dispatched = new Set([...list.matchAll(/\b(handle\w+)\b/gu)].map((match) => match[1]!));
    const listed = new Set([
      ...(PROTECTED[area] ?? []).map((route) => route.route),
      ...(PUBLIC[area] ?? []),
    ]);
    expect([...dispatched].sort()).toEqual([...listed].sort());
  });
});

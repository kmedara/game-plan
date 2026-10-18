/**
 * Schedule area Lambda.
 *
 * Dispatches practices, games, recurrence expansion, and per-occurrence RSVP.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handleHealth, logHttpFailure, notFound } from '../../lib/http.js';
import { runDueReminders } from './reminders.js';
import {
  handleCancelOccurrence,
  handleClaimCarpool,
  handleCreateEvent,
  handleDeleteEvent,
  handleGetCarpool,
  handleGetEvent,
  handleAcceptFixture,
  handleDeclineFixture,
  handleGetLineup,
  handleListFixtures,
  handleListSchedule,
  handleProposeFixture,
  handlePutCarpool,
  handlePutLineup,
  handleSaveOccurrence,
  handleUnlinkFixture,
  handleUpdateEvent,
  handleUpdateFixture,
  handleUpsertRsvp,
} from './routes/index.js';

/**
 * Normalizes a path to the schedule route suffix.
 *
 * @param path - The raw request path.
 * @returns The route key without a leading slash, or an empty string for `/schedule`.
 */
const routeOf = (path: string): string => {
  const normalized = path.replace(/\/+$/u, '') || '/';
  if (normalized === '/schedule' || normalized === '/') return '';
  if (normalized.startsWith('/schedule/')) return normalized.slice('/schedule/'.length);
  if (normalized.startsWith('/')) return normalized.slice(1);
  return normalized;
};

/**
 * Handles HTTP requests for the schedule area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
const httpHandler = logHttpFailure(async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const path = event.rawPath ?? '';
  const method = event.requestContext.http.method;

  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return handleHealth(event, 'schedule');
  }

  const route = routeOf(path);
  const parts = route.length === 0 ? [] : route.split('/');

  if (parts[0] === 'teams' && parts[1] !== undefined) {
    const teamId = parts[1];

    if (method === 'GET' && parts.length === 2) {
      return handleListSchedule(event, teamId);
    }

    if (parts[2] === 'fixtures' && method === 'GET' && parts.length === 3) {
      return handleListFixtures(event, teamId);
    }

    if (parts[2] === 'events') {
      if (method === 'POST' && parts.length === 3) {
        return handleCreateEvent(event, teamId);
      }
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[3] !== undefined &&
        parts[4] === 'fixture'
      ) {
        return handleProposeFixture(event, teamId, parts[3]);
      }
      if (parts.length === 4 && parts[3] !== undefined) {
        const eventId = parts[3];
        if (method === 'GET') return handleGetEvent(event, teamId, eventId);
        if (method === 'PATCH') return handleUpdateEvent(event, teamId, eventId);
        if (method === 'DELETE') return handleDeleteEvent(event, teamId, eventId);
      }
      if (parts.length === 5 && parts[3] !== undefined && parts[4] === 'occurrences') {
        const eventId = parts[3];
        if (method === 'POST') return handleSaveOccurrence(event, teamId, eventId);
        if (method === 'DELETE') return handleCancelOccurrence(event, teamId, eventId);
      }
    }

    if (parts[2] === 'rsvps' && method === 'PUT' && parts.length === 3) {
      return handleUpsertRsvp(event, teamId);
    }

    if (parts[2] === 'lineup' && parts.length === 3) {
      if (method === 'GET') return handleGetLineup(event, teamId);
      if (method === 'PUT') return handlePutLineup(event, teamId);
    }

    if (parts[2] === 'carpool' && parts.length === 3) {
      if (method === 'GET') return handleGetCarpool(event, teamId);
      if (method === 'PUT') return handlePutCarpool(event, teamId);
    }

    if (parts[2] === 'carpool' && parts[3] === 'claim' && method === 'PUT' && parts.length === 4) {
      return handleClaimCarpool(event, teamId);
    }
  }

  if (parts[0] === 'fixtures' && parts[1] !== undefined) {
    const fixtureId = parts[1];
    if (parts.length === 2 && method === 'PATCH') return handleUpdateFixture(event, fixtureId);
    if (parts.length === 2 && method === 'DELETE') return handleUnlinkFixture(event, fixtureId);
    if (parts.length === 3 && parts[2] === 'accept' && method === 'POST') {
      return handleAcceptFixture(event, fixtureId);
    }
    if (parts.length === 3 && parts[2] === 'decline' && method === 'POST') {
      return handleDeclineFixture(event, fixtureId);
    }
  }

  return notFound();
});

/**
 * Handles API Gateway requests and the reminder sweep from EventBridge.
 *
 * @param event - An HTTP API event, or `{ source: 'gameplan.reminders' }`.
 * @returns The HTTP response, or an empty 200 after a sweep.
 */
export const handler = async (
  event: APIGatewayProxyEventV2 | { source?: string },
): Promise<APIGatewayProxyStructuredResultV2> => {
  if ('source' in event && event.source === 'gameplan.reminders' && !('requestContext' in event)) {
    await runDueReminders(new Date());
    return { statusCode: 200, body: '' };
  }
  return httpHandler(event as APIGatewayProxyEventV2);
};

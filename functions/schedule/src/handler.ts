/**
 * Schedule area Lambda.
 *
 * Dispatches practices, games, recurrence expansion, and per-occurrence RSVP.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handleHealth, notFound } from '../../lib/http.js';
import {
  handleCreateEvent,
  handleGetEvent,
  handleListSchedule,
  handleUpdateEvent,
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
export const handler = async (
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

    if (parts[2] === 'events') {
      if (method === 'POST' && parts.length === 3) {
        return handleCreateEvent(event, teamId);
      }
      if (parts.length === 4 && parts[3] !== undefined) {
        const eventId = parts[3];
        if (method === 'GET') return handleGetEvent(event, teamId, eventId);
        if (method === 'PATCH') return handleUpdateEvent(event, teamId, eventId);
      }
    }

    if (parts[2] === 'rsvps' && method === 'PUT' && parts.length === 3) {
      return handleUpsertRsvp(event, teamId);
    }
  }

  return notFound();
};

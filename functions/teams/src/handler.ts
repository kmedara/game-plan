/**
 * Teams area Lambda.
 *
 * Dispatches create team, team settings, roster, invites, join requests, roles,
 * and the permission matrix to route modules.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handleHealth, notFound } from '../../lib/http.js';
import {
  handleAcceptInvite,
  handleApproveJoinRequest,
  handleAssignRole,
  handleCreateInvite,
  handleCreateJoinRequest,
  handleCreateTeam,
  handleGetInvite,
  handleGetPermissions,
  handleGetTeam,
  handleListInvites,
  handleListJoinRequests,
  handleListMembers,
  handleListTeams,
  handleRejectJoinRequest,
  handleSearchDirectory,
  handleSetPositions,
  handleUpdatePermissions,
  handleUpdateTeam,
} from './routes/index.js';

/**
 * Normalizes a path to the teams route suffix.
 *
 * @param path - The raw request path.
 * @returns The route key without a leading slash, or an empty string for `/teams`.
 */
const routeOf = (path: string): string => {
  const normalized = path.replace(/\/+$/u, '') || '/';
  if (normalized === '/teams' || normalized === '/') return '';
  if (normalized.startsWith('/teams/')) return normalized.slice('/teams/'.length);
  if (normalized.startsWith('/')) return normalized.slice(1);
  return normalized;
};

/**
 * Handles HTTP requests for the teams area.
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
    return handleHealth(event, 'teams');
  }

  const route = routeOf(path);
  const parts = route.length === 0 ? [] : route.split('/');

  if (method === 'POST' && parts.length === 0) return handleCreateTeam(event);
  if (method === 'GET' && parts.length === 0) return handleListTeams(event);

  if (method === 'GET' && parts.length === 1 && parts[0] === 'directory') {
    return handleSearchDirectory(event);
  }

  if (parts[0] === 'invite' && parts[1] !== undefined) {
    const code = parts[1];
    if (method === 'GET' && parts.length === 2) return handleGetInvite(event, code);
    if (method === 'POST' && parts.length === 3 && parts[2] === 'accept') {
      return handleAcceptInvite(event, code);
    }
  }

  if (parts.length >= 1 && parts[0] !== 'invite') {
    const teamId = parts[0];

    if (method === 'GET' && parts.length === 1) return handleGetTeam(event, teamId);
    if (method === 'PATCH' && parts.length === 1) return handleUpdateTeam(event, teamId);
    if (method === 'PUT' && parts.length === 2 && parts[1] === 'positions') {
      return handleSetPositions(event, teamId);
    }

    if (parts[1] === 'members') {
      if (method === 'GET' && parts.length === 2) return handleListMembers(event, teamId);
      if (method === 'PATCH' && parts.length === 3 && parts[2] !== undefined) {
        return handleAssignRole(event, teamId, parts[2]);
      }
    }

    if (parts[1] === 'permissions') {
      if (method === 'GET' && parts.length === 2) return handleGetPermissions(event, teamId);
      if (method === 'PUT' && parts.length === 2) return handleUpdatePermissions(event, teamId);
    }

    if (parts[1] === 'invites') {
      if (method === 'POST' && parts.length === 2) return handleCreateInvite(event, teamId);
      if (method === 'GET' && parts.length === 2) return handleListInvites(event, teamId);
    }

    if (parts[1] === 'join-requests') {
      if (method === 'POST' && parts.length === 2) {
        return handleCreateJoinRequest(event, teamId);
      }
      if (method === 'GET' && parts.length === 2) {
        return handleListJoinRequests(event, teamId);
      }
      if (parts.length === 4 && parts[2] !== undefined) {
        const requestId = parts[2];
        if (method === 'POST' && parts[3] === 'approve') {
          return handleApproveJoinRequest(event, teamId, requestId);
        }
        if (method === 'POST' && parts[3] === 'reject') {
          return handleRejectJoinRequest(event, teamId, requestId);
        }
      }
    }
  }

  return notFound();
};

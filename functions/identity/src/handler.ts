/**
 * Identity area Lambda.
 *
 * Dispatches register, email confirmation, login, refresh, logout, OAuth, profile complete, socket tickets, and `GET /me`.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handleHealth, logHttpFailure, notFound, rejectDirectOrigin } from '../../lib/http.js';
import {
  handleAcceptGuardianInvite,
  handleCompleteProfile,
  handleCreateGuardianInvite,
  handleRemoveGuardianLink,
  handleConfirmRegistration,
  handleLogin,
  handleLogout,
  handleMe,
  handleOAuthCallback,
  handleOAuthExchange,
  handleOAuthLogin,
  handleOAuthLogout,
  handleRefresh,
  handleRegister,
  handleResendConfirmation,
  handleSocketTicket,
  handleUpdateProfile,
} from './routes/index.js';

/**
 * Normalizes a path to the identity route suffix (`register`, `me`, …).
 *
 * @param path - The raw request path.
 * @returns The route key without a leading slash, or `undefined`.
 */
const routeOf = (path: string): string | undefined => {
  const normalized = path.replace(/\/+$/u, '') || '/';
  if (normalized === '/identity' || normalized === '/') return '';
  if (normalized.startsWith('/identity/')) return normalized.slice('/identity/'.length);
  if (normalized.startsWith('/')) return normalized.slice(1);
  return normalized;
};

/**
 * Handles HTTP requests for the identity area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
export const handler = logHttpFailure(async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const rejected = rejectDirectOrigin(event);
  if (rejected !== undefined) return rejected;

  const path = event.rawPath ?? '';
  const method = event.requestContext.http.method;

  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return handleHealth(event, 'identity');
  }

  const route = routeOf(path);

  if (method === 'POST' && route === 'register') return handleRegister(event);
  if (method === 'POST' && route === 'confirm/resend') return handleResendConfirmation(event);
  if (method === 'POST' && route === 'confirm') return handleConfirmRegistration(event);
  if (method === 'POST' && route === 'login') return handleLogin(event);
  if (method === 'POST' && route === 'refresh') return handleRefresh(event);
  if (method === 'POST' && route === 'logout') return handleLogout(event);
  if (method === 'GET' && route === 'me') return handleMe(event);
  if (method === 'POST' && route === 'socket-ticket') return handleSocketTicket(event);
  if (method === 'GET' && route === 'oauth/login') return handleOAuthLogin(event);
  if (method === 'GET' && route === 'oauth/callback') return handleOAuthCallback(event);
  if (method === 'GET' && route === 'oauth/logout') return handleOAuthLogout(event);
  if (method === 'POST' && route === 'oauth/exchange') return handleOAuthExchange(event);
  if (method === 'POST' && route === 'profile/complete') return handleCompleteProfile(event);
  if (method === 'POST' && route === 'guardians') return handleCreateGuardianInvite(event);
  if (route?.startsWith('guardians/') === true) {
    const parts = route.split('/');
    if (method === 'POST' && parts.length === 3 && parts[2] === 'accept' && parts[1] !== undefined) {
      return handleAcceptGuardianInvite(event, parts[1]);
    }
    if (method === 'DELETE' && parts.length === 2 && parts[1] !== undefined) {
      return handleRemoveGuardianLink(event, parts[1]);
    }
  }
  if (method === 'PATCH' && route === 'profile') return handleUpdateProfile(event);

  return notFound();
});

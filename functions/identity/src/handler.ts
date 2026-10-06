/**
 * Identity area Lambda.
 *
 * Dispatches register, login, refresh, logout, OAuth, profile complete, and `GET /me`.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handleHealth, notFound } from '../../lib/http.js';
import {
  handleCompleteProfile,
  handleLogin,
  handleLogout,
  handleMe,
  handleOAuthCallback,
  handleOAuthLogin,
  handleOAuthLogout,
  handleRefresh,
  handleRegister,
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
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const path = event.rawPath ?? '';
  const method = event.requestContext.http.method;

  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return handleHealth(event, 'identity');
  }

  const route = routeOf(path);

  if (method === 'POST' && route === 'register') return handleRegister(event);
  if (method === 'POST' && route === 'login') return handleLogin(event);
  if (method === 'POST' && route === 'refresh') return handleRefresh(event);
  if (method === 'POST' && route === 'logout') return handleLogout(event);
  if (method === 'GET' && route === 'me') return handleMe(event);
  if (method === 'GET' && route === 'oauth/login') return handleOAuthLogin(event);
  if (method === 'GET' && route === 'oauth/callback') return handleOAuthCallback(event);
  if (method === 'GET' && route === 'oauth/logout') return handleOAuthLogout(event);
  if (method === 'POST' && route === 'profile/complete') return handleCompleteProfile(event);

  return notFound();
};

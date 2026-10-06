/**
 * Places area Lambda.
 *
 * Proxies Google Places autocomplete, place details, and Static Maps so the
 * API key never reaches the client.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handleHealth, notFound } from '../../lib/http.js';
import { handleAutocomplete, handleMapPreview, handleResolve, handleReverse } from './routes/index.js';

/**
 * Normalizes a path to the places route suffix.
 *
 * @param path - The raw request path.
 * @returns The route key without a leading slash, or an empty string for `/places`.
 */
const routeOf = (path: string): string => {
  const normalized = path.replace(/\/+$/u, '') || '/';
  if (normalized === '/places' || normalized === '/') return '';
  if (normalized.startsWith('/places/')) return normalized.slice('/places/'.length);
  if (normalized.startsWith('/')) return normalized.slice(1);
  return normalized;
};

/**
 * Handles HTTP requests for the places area.
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
    return handleHealth(event, 'places');
  }

  const route = routeOf(path);
  if (method === 'GET' && route === 'autocomplete') return handleAutocomplete(event);
  if (method === 'GET' && route === 'resolve') return handleResolve(event);
  if (method === 'GET' && route === 'reverse') return handleReverse(event);
  if (method === 'GET' && route === 'map') return handleMapPreview(event);

  return notFound();
};

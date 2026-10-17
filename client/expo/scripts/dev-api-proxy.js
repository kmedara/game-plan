/**
 * Forwards `/api` from the Expo web dev server to the local API proxy.
 *
 * The browser stays on the website origin. The prefix is removed before the
 * request reaches the area processes, matching the CloudFront function.
 */

const http = require('node:http');
const https = require('node:https');

const API_PREFIX = '/api';

/**
 * Removes the `/api` prefix from a request URL.
 *
 * @param rawUrl - The request URL, including any query string.
 * @returns The upstream path, or `undefined` when the request is not under `/api`.
 */
const stripApiPrefix = (rawUrl) => {
  const url = rawUrl ?? '/';
  const queryIndex = url.indexOf('?');
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : url.slice(queryIndex);
  if (pathname === API_PREFIX) return `/${query}`;
  if (pathname.startsWith(`${API_PREFIX}/`)) return `${pathname.slice(API_PREFIX.length)}${query}`;
  return undefined;
};

/**
 * Proxies one `/api` request to the local API.
 *
 * @param req - The incoming request.
 * @param res - The response to write.
 * @returns `true` when this request was under `/api`.
 */
const proxyApiRequest = (req, res) => {
  const stripped = stripApiPrefix(req.url);
  if (stripped === undefined) return false;
  const target = new URL(process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000');
  const transport = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };
  const upstream = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: stripped,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_unavailable' }));
  });
  req.pipe(upstream);
  return true;
};

module.exports = { stripApiPrefix, proxyApiRequest };

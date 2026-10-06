/**
 * Local reverse proxy that forwards `/<area>/…` to the matching area process.
 *
 * Day-to-day work uses one origin on port {@link PROXY_PORT} instead of remembering
 * seven loopback ports. WebSocket upgrades for `/socket` go to the socket process.
 */

import { createServer } from 'node:http';
import httpProxy from 'http-proxy';
import { PROXY_PORT, portForPath } from '../../functions/lib/names.js';
import { serveDocs } from './docs.js';

/** Shared proxy instance that rewrites `X-Forwarded-*` headers. */
const proxy = httpProxy.createProxyServer({ xfwd: true });

proxy.on('error', (_error, _req, res) => {
  if ('writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_unavailable' }));
  }
});

const server = createServer((req, res) => {
  if (serveDocs(req, res)) return;
  const port = portForPath(req.url ?? '/');
  if (port === undefined) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  proxy.web(req, res, { target: `http://127.0.0.1:${port}` });
});

server.on('upgrade', (req, socket, head) => {
  const port = portForPath(req.url ?? '/');
  if (port === undefined) {
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head, { target: `http://127.0.0.1:${port}` });
});

server.listen(PROXY_PORT, process.env.LISTEN_HOST ?? '127.0.0.1', () => {
  const host = process.env.LISTEN_HOST ?? '127.0.0.1';
  console.info(`proxy http://${host}:${PROXY_PORT}`);
});

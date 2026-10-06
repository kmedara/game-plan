/**
 * Swagger UI page for the local proxy at `/docs`.
 *
 * The OpenAPI document comes from `@gameplan/schemas`; the UI files come from the
 * `swagger-ui-dist` package. Deployed API Gateway has no docs route.
 */

import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { openApiDocument } from '@gameplan/schemas';

/** Folder that holds the prebuilt Swagger UI files. */
const require = createRequire(import.meta.url);
const assetDir = dirname(require.resolve('swagger-ui-dist/package.json'));

/** Only these files are served, so the URL can't reach anything else on disk. */
const ASSETS: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
};

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>GamePlan API</title>
    <link rel="stylesheet" href="/docs/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({ url: '/docs/openapi.json', dom_id: '#swagger-ui' });
    </script>
  </body>
</html>
`;

/**
 * Answers `/docs`, `/docs/openapi.json`, and the Swagger UI asset files.
 *
 * @param req - The incoming request.
 * @param res - The response to write.
 * @returns `true` when the request was a docs request and has been answered.
 */
export const serveDocs = (req: IncomingMessage, res: ServerResponse): boolean => {
  const pathname = (req.url ?? '/').split('?')[0]?.replace(/\/+$/u, '') ?? '';
  if (req.method !== 'GET' || (pathname !== '/docs' && !pathname.startsWith('/docs/'))) {
    return false;
  }

  if (pathname === '/docs') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return true;
  }

  const name = pathname.slice('/docs/'.length);
  if (name === 'openapi.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(openApiDocument));
    return true;
  }

  const contentType = ASSETS[name];
  if (contentType === undefined) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return true;
  }
  res.writeHead(200, { 'content-type': contentType });
  createReadStream(join(assetDir, name)).pipe(res);
  return true;
};

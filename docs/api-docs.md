# API docs (Swagger)

The local stack serves an interactive **Swagger UI** page at http://localhost:3000/docs. It lists every HTTP route by
product area, shows the request body and query string for each one, and can send real requests through the local proxy
with **Try it out**. The page only exists locally; the deployed Amazon API Gateway has no docs route.

## How it works

**Browser** → **local proxy** (`/docs`) → **Swagger UI page** → **`/docs/openapi.json`** → **area processes**

- **The OpenAPI document** lives in [openapi.ts](../lib/schemas/src/openapi.ts). OpenAPI is the standard JSON format
  that Swagger UI reads. The document follows OpenAPI 3.1, which uses plain JSON Schema, so Zod schemas are converted
  with `zod-to-json-schema` before they are placed in the document.
- **The proxy** in [proxy.ts](../local/src/proxy.ts) hands `/docs` requests to [docs.ts](../local/src/docs.ts) before
  forwarding anything to an area process. That module returns the page, the JSON document, and two files from the
  `swagger-ui-dist` package (`swagger-ui.css` and `swagger-ui-bundle.js`). Any other `/docs/...` path gets a `404`.
- **Responses** are shown as generic JSON. Errors use the shared `{ error }` body. The media presign routes and the
  identity session routes show their real response shapes, since those schemas already exist.

The `socket` and `fanout` areas are left out. They carry WebSocket and internal queue traffic, not public REST calls.
The media `local-objects` routes are also left out, since they only stand in for signed Amazon Simple Storage Service
(S3) URLs during local development.

## Signing in

Routes outside `identity` are marked with a **bearer** security scheme, which means they expect a Cognito access token
in the `Authorization` header. Locally, `AUTH_DISABLED` defaults to `true`, so every request runs as the seed user and
**Try it out** works without a token. With auth turned on, paste an access token from `POST /identity/login` into the
**Authorize** dialog.

## Keeping the spec in sync

Each area's `handler.ts` matches paths by hand, so there's no route list to generate the document from. When a route is
added, renamed, or removed in a `functions/<area>/src/handler.ts`, update the matching entry in
[openapi.ts](../lib/schemas/src/openapi.ts):

- **Path parameters** come from `{name}` segments in the path, such as `/teams/{teamId}`.
- **Request bodies** go in `body`, using the schema the route already validates with.
- **Query strings** go in `query` as a Zod object; each property becomes a query parameter.

[openapi.test.ts](../lib/schemas/src/openapi.test.ts) checks that the document serializes, that every area has routes,
and that every `{param}` in a path is declared.

After pulling a change that adds `swagger-ui-dist`, rebuild the Compose images once with `npm run up:build`, since the
dependency comes from `package-lock.json`.

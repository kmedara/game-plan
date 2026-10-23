# HTTP API

GamePlan’s product API is **Lambda function URLs** behind CloudFront at `/api/<area>/…`. Contracts live in `lib/schemas`; each **area** is one deployable function under `functions/<area>`. Domain features (schedule, chat, billing, …) are described in [`ARCHITECTURE.md`](ARCHITECTURE.md#stack). This doc is routing, auth, edge behavior, and operations.

| | Choice | Main cost |
| --- | --- | --- |
| Transport | CloudFront → function URL (no API Gateway on HTTP) | JWT verified in-function; client body hash on writes |
| Structure | Typed `route()` pipeline per area | Literal path typos are runtime `404`s |
| Data | Single DynamoDB table, on-demand | Queries must start at a partition key |
| Side effects | SQS fan-out after write | Response returns before live delivery ([`realtime.md`](realtime.md)) |

**Public URL:** `https://<environment>.<domain>/api/<area>/<path>` ([`dns-and-hosting.md`](dns-and-hosting.md)).

**Interactive docs (local only):** Swagger UI at `http://localhost:3000/docs` — see [`api-docs.md`](api-docs.md).

## Areas

Canonical list: `config/resources.json` and `infrastructure/lib/names.ts`. Areas do **not** call each other; they share the table and enqueue fan-out when needed.

| Area | CloudFront `/api` | Role |
| --- | --- | --- |
| `identity` | Yes | Auth, profile, OAuth BFF, socket tickets |
| `teams` | Yes | Teams, roster, invites, join requests |
| `schedule` | Yes | Events, RSVP, fixtures, feeds, reminders |
| `chat` | Yes | Chats, messages, polls |
| `media` | Yes | Presigns, devices (push tokens) |
| `places` | Yes | Geocoding (Google Maps server key) |
| `payments` | Yes | Connect, dues, charges |
| `billing` | Yes | Subscriptions, Checkout, portal |
| `orgs` | Yes | Organizations, org billing |
| `socket` | No (WebSocket API) | `$connect` authorizer, keepalive |
| `fanout` | No | SQS consumer; local `POST /fanout/deliver` |

**Separate public URLs** (not behind CloudFront OAC): Stripe webhooks (`payments-webhook`, `billing-webhook`), CSP report — [`stripe.md`](stripe.md).

## HTTP edge

```text
Client → CloudFront (/api/<area>/*) → SigV4 + OAC → Lambda function URL (AWS_IAM)
```

- There is **no API Gateway** on HTTP paths. WebSockets still use API Gateway ([`realtime.md`](realtime.md)).
- **Why:** one fewer hop and no per-request API Gateway charge; TLS, compression, and WAF sit on CloudFront.
- **Cost:**
  - No gateway JWT authorizer — protected routes verify Cognito access tokens in the function (`functions/lib/auth/cognito.ts`).
  - Origin access control (OAC) signs with SigV4 and does **not** hash the body. Clients send `x-amz-content-sha256` on writes (`withContentHash` in `client/session`).
  - OAC overwrites `Authorization`. A CloudFront Function copies the bearer token to `x-viewer-authorization` before signing (`infrastructure/lib/site-api.ts`, `functions/lib/http.ts`).
  - API Gateway stage throttling is gone; **WAF** rate-limits `/api/` ([`security.md`](security.md#rate-limits-waf)). Areas enable X-Ray themselves.

Direct calls to a function URL **fail** unless they impersonate CloudFront’s SigV4 invoke — intentional, so traffic passes WAF first ([`dns-and-hosting.md`](dns-and-hosting.md#what-cloudfront-serves)). Full edge model: [`security.md`](security.md#edge-and-api-access).

## Routes and pipeline

Every HTTP route is `route(method, path, ...steps, handler)` from `functions/lib/pipeline.ts`. The path string is both the URL and the handler’s typed fields.

```ts
export const handleSendMessage = route(
  'POST',
  '/chat/:chatId/messages',
  withChatErrors(),
  requireUser(),
  withBodyValidation(sendMessageBodySchema),
  async ({ chatId, user, body }) => { /* ... */ },
);
```

- **Parameters:** `:chatId` → field `chatId`. `*objectKey` captures the rest of the path (including slashes) and must be last.
- **Dispatch:** Each area passes its routes to `dispatch`. More **literal** segments win (`/teams/directory` over `/teams/:teamId`). Same score → earlier route wins. `GET /health` runs before the route list.
- **Prefix stripping:** The matcher accepts paths with the area prefix omitted (`devices/phone` → `/media/devices/:deviceId`). Missing path → `/`.
- **Steps:** Outermost first. A step returns a response to stop, or attaches context and calls `next`. Guards throw codes (`not_a_member`, `forbidden`); the area’s error step (listed first) maps codes to HTTP statuses.
- **Validation:** Body/query Zod schemas in `lib/schemas` parse before the handler → `400 { errors: [{ field, message }] }` ([Standard Schema](https://standardschema.dev)).
- **Core:** `lib/pipeline` has no HTTP types; `functions/lib/pipeline.ts` binds Lambda events.

List cheap checks first: error mapping, `requireUser`, validation, then DynamoDB guards. `requirePermission` reuses `requireMembership`’s member row (two reads when both run). `logHttpFailure` logs every `4xx` and `5xx`.

- **Why:** Parameter names are inferred from the path; no router dependency.
- **Cost:** Recursive tuple types slow typecheck slightly. A typo in a literal segment is a runtime `404`.

### Warm state

Per container, on first use then reused: DynamoDB client, Cognito verifier (+ JWKS), five-minute Parameter Store cache. Tests reset with `resetDocClient`, `resetAccessVerifier`, `resetParameterCache`.

## Authentication, authorization, and IAM

Sessions, JWT verification, team permissions, minors, WAF rate limits, DynamoDB prefix IAM, and runtime secrets are documented in [`security.md`](security.md).

**Data model (API-relevant):** One on-demand DynamoDB table; partition keys such as `USER#`, `TEAM#`, `CHAT#`, `ORG#`; GSIs for email and connection id. Socket rows use `ttl`.

## Contracts

- **Source of truth:** Zod in `lib/schemas`. `npm run generate:types` → `lib/types` for the client.
- **OpenAPI:** Hand-maintained in `lib/schemas/src/openapi.ts` for local Swagger; update when routes change ([`api-docs.md`](api-docs.md)).

The client never imports Zod or `functions/*`.

## Bundle size and latency

- One **esbuild** bundle per area; `npm run inspect:api` for sizes. `places` does not pull chat code.
- ESM, minified, Node 22; `sideEffects: false` on `lib/schemas`.
- No source maps in deployed bundles.
- SDK v3 clients lazily created and reused in warm containers.
- **Writes** return after DynamoDB persist; fan-out is async on SQS.
- **Media:** Presigned S3 URLs only (15 MB cap, 15-minute download TTL); bytes never stream through Lambda.
- **Recurring schedule:** One stored series, expanded for the request window (~three month cap).

**Open:** Measure p95 cold start per area; consider provisioned concurrency or more memory on hot paths (identity, chat). API runs in `us-east-1`; distant users pay RTT each call.

## Local development

`npm run up` (or `local`) runs each area as a process on port **3000** via a proxy, against DynamoDB Local, using the same handlers as Lambda.

- **Swagger:** `/docs` ([`api-docs.md`](api-docs.md)).
- **Auth:** Compose can use deployed Cognito; offline use `AUTH_PROVIDER=local` and `LOCAL_JWT_SECRET` (never in production).
- **Skipped locally:** CloudFront, OAC, WAF, IAM on function URLs. Exercise those in staging; CDK synth tests assert edge wiring (`infrastructure/lib/*.test.ts`).

Fan-out: chat/schedule may `POST` `/fanout/deliver` on the fanout process.

## Key files

| Path | Role |
| --- | --- |
| `functions/lib/pipeline.ts` | `route`, `dispatch`, Lambda binding |
| `lib/pipeline` | Step types and compile-time deps |
| `functions/lib/http.ts` | Viewer auth header, content hash |
| `functions/lib/auth/` | Cognito and local JWT |
| `functions/lib/guards.ts`, `permissions.ts`, `entitlements.ts` | Access control |
| `functions/<area>/src/handler.ts` | Route list per area |
| `infrastructure/lib/api.ts` | Lambdas, URLs, webhooks, socket API |
| `infrastructure/lib/site-api.ts` | CloudFront `/api` behaviors, OAC |
| `local/src/proxy.ts` | Local routing and `/docs` |

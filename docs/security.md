# Security

How GamePlan limits who can reach the API, what they can do, and how secrets and data are handled. Transport and route mechanics live in [`api.md`](api.md); browser session UX in [`client.md`](client.md); hosting edge in [`dns-and-hosting.md`](dns-and-hosting.md).

| Layer | Mechanism | Doc |
| --- | --- | --- |
| Edge | CloudFront-only invoke, WAF on `/api/` | Below, [`api.md`](api.md#http-edge) |
| AuthN | Cognito access JWT, BFF OAuth, socket tickets | [Authentication](#authentication-and-sessions) |
| AuthZ | Membership, permissions, entitlements, minors | [Authorization](#authorization) |
| Data | IAM prefix limits, presigned media | [IAM](#iam-least-privilege), [Storage](#storage) |
| Browser | CSP, sandboxed uploads, no HTML injection | [Website](#website-and-browser-hardening) |

## Edge and API access

### Only CloudFront can invoke product HTTP

- Lambda **function URLs** for `/api/<area>` use **`AWS_IAM`**. The site stack grants `lambda:InvokeFunctionUrl` to the **CloudFront service principal**, scoped to that distribution. A direct call to the function URL fails.
- The **site bucket** blocks public access; static files use origin access control (OAC).
- **Body integrity:** OAC SigV4 does not hash the body. Clients send `x-amz-content-sha256` on writes (`withContentHash` in `client/session`).
- **Bearer token:** OAC overwrites `Authorization`. A CloudFront Function moves the viewer bearer to `x-viewer-authorization` before signing; the function strips forged values from clients.

### Exceptions (public URLs)

These endpoints are **not** behind CloudFront OAC; they rely on their own verification:

| Target | Gate |
| --- | --- |
| Stripe webhooks | `Stripe-Signature` on raw body ([`stripe.md`](stripe.md)) |
| CSP report | Public URL; logs only |
| Calendar `.ics` feeds | Unguessable token in path (capability URL) |

### Rate limits (WAF)

WAF attaches to `/api/*` only. Six rules, five-minute windows, `429` with `{"error":"rate_limited"}`. Pay-as-you-go WAF is used so rules can key on headers.

| Rule | Key | Limit | Purpose |
| --- | --- | --- | --- |
| `PerAccessToken` | `Authorization` | 600 | Signed-in fairness |
| `PerAnonymousIp` | IP, no token | 100 | Signup / open identity abuse |
| `SocketConnectIp` | IP, `/api/socket` | 1000 | Connect floods |
| `PerIpFlood` | IP | 4000 | Random bearer per request |
| `PerCalendarFeed` | Path `/api/schedule/feeds/` | 30 | Leaked feed link |
| `CalendarFeedIp` | IP, feeds path | 20000 | Google/Outlook fetchers |

The token rule uses the **raw** `Authorization` header (including invalid tokens). A verified-user limit would need to run inside Lambda.

Implementation: `infrastructure/lib/api-edge.ts`.

## Authentication and sessions

### Backend-for-frontend OAuth

The app never calls Cognito’s token endpoint directly. The **`identity`** area runs authorization code + **PKCE**, exchanges the code server-side, and returns tokens to the client. The app client has **no secret** (`generateSecret: false`). `preventUserExistenceErrors` is enabled on the pool.

### Tokens and refresh

- **Access token:** Verified on protected routes with `aws-jwt-verify` (signature, issuer, client id, `token_use=access`). Missing Cognito configuration rejects every token.
- **Website:** Access token in **memory** only (not `localStorage`). Refresh in HttpOnly cookie `ts_refresh` (`Secure` in production, `SameSite=Lax`, path `/api/identity`).
- **Native:** Refresh in Expo SecureStore; OAuth completes via short-lived `gameplan://auth?code=…` handoff (conditional delete in DynamoDB).
- **One refresh in flight:** Shared `POST /identity/refresh` across the shell and `401` recovery.
- **Local dev only:** `AUTH_PROVIDER=local` and `LOCAL_JWT_SECRET` — **refused** when `NODE_ENV=production`.

Client-side details: [`client.md`](client.md#session-and-api-calls).

### WebSocket connect

Browsers cannot set `Authorization` on WebSocket handshakes.

1. **`POST /identity/socket-ticket`** — one-time ticket, 60 seconds, conditional delete on redeem.
2. Connect to `wss://<host>/api/socket?ticket=…` through CloudFront.
3. **`x-origin-verify`** — shared secret CloudFront adds; `$connect` authorizer rejects direct `execute-api` connects. Authorizer **caching is off** so tickets cannot replay from cache.
4. Ticket required even if origin secret leaked.

See [`realtime.md`](realtime.md).

### Staging signups

Pre-signup Lambda enforces `<prefix>/staging-signup-allowlist` in Parameter Store.

## Authorization

Enforced in the **`route()` pipeline** before handlers (`functions/lib/guards.ts`, `permissions.ts`, `entitlements.ts`).

- **Team access:** `requireMembership`, `requirePermission` load the member row and permission matrix from DynamoDB.
- **Plans:** `requireEntitlement`, `underLimit` → `plan_required` / `plan_limit_reached` → HTTP `402`.
- **Minors (`lib/rules`):** Cannot create a team, be `team_admin`, or hold `manage_permissions`. Chat limited to shared teammates and linked guardians. Directory search returns **adults only**, exact email match.
- **Medical:** `view_medical_info` for staff reads; audit rows on team partition; not persisted on device ([`ARCHITECTURE.md` — Emergency and medical info](ARCHITECTURE.md#emergency-and-medical-info)).
- **Media downloads:** Own uploads by key prefix; otherwise require membership on the chat, team, or profile context.

Validation uses Zod at the route edge — malformed input never reaches business logic.

## Website and browser hardening

On the **website** CloudFront behavior (`infrastructure/lib/website.ts`):

- **TLS** 1.2+; HTTP → HTTPS. **HSTS** (one year, subdomains, preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, strict referrer policy.
- **Content-Security-Policy:** Scripts from this origin and Google Maps only — no `'unsafe-inline'` or `'unsafe-eval'` for scripts. `connect-src` includes this origin (`wss:`), media bucket origins, and Maps. `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`. **Styles** allow `'unsafe-inline'` (react-native-web). Access token in page memory remains XSS-sensitive for scripts.
- **Rendering:** React text nodes only — no `dangerouslySetInnerHTML`, `innerHTML`, or `eval` for user content.
- **Uploaded media** at `/<MEDIA_CDN_KEY_PREFIX>/*`: separate response policy with `Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`, `no-referrer` so HTML/SVG uploads cannot script against the app origin.

## Capability URLs

- **Calendar feeds:** `GET /schedule/feeds/<token>.ics` — no session; 192-bit token. **Reset link** rotates token. WAF limits abuse ([rate limits](#rate-limits-waf)).
- **Team invite codes:** Opaque codes; join flow validates server-side. Invite email/SMS content is **server-built** (client cannot send arbitrary text as GamePlan). Daily send caps on team and sender.

## IAM least privilege

Each area Lambda role limits **DynamoDB** access with `dynamodb:LeadingKeys` (`infrastructure/lib/table-access.ts`). `ForAllValues` blocks transactions that mix unrelated prefixes.

Examples:

- **`places`:** No table access.
- **`schedule`:** `TEAM#`, `REMINDERS`, carpool-related `CHAT#` / `USER#`.
- **`fanout`:** Read delivery prefixes; may delete a specific `USER#` connection or device row when push/socket reports gone (delete scoped to known sort key in code).
- **`payments` / webhooks:** Webhook function writes narrower prefixes than the main payments area ([`stripe.md`](stripe.md)).
- **`identity`:** May `AdminGetUser` / `AdminDeleteUser` for signup replacement flows.

**CI/CD:** GitHub Actions uses OIDC (`AWS_ROLE_ARN` per environment). Deploy logs are redacted.

**Other AWS:** S3 buckets block public access, SSE-S3, TLS required. Media bucket CORS allows only the website origin. SQS uses SSE.

## Storage

- **Product table:** Single-table design; access patterns scoped by partition prefix in IAM.
- **Media bucket:** Private; uploads/downloads via **presigned URLs** (size and TTL caps in `media` area). No object bytes through Lambda.
- **Website bucket:** Private; CloudFront OAC only; `DESTROY` with stack (rebuildable).

## Secrets at run time

Secret **values** are not Lambda environment variables (visible via `GetFunctionConfiguration` and version snapshots).

Functions receive **parameter names** and read through `readSecret` (`functions/lib/parameters.ts`), cached **five minutes** per warm container.

| Secret | Consumer | Parameter |
| --- | --- | --- |
| Google Maps server key | places | `<prefix>/google-maps-api-key` |
| VAPID private key | fanout | `<prefix>/vapid-private-key` |
| Socket origin verify | socket authorizer | `<prefix>/socket-origin-verify` |
| Stripe secret key | payments, billing, orgs, webhooks | `<prefix>/stripe-secret-key` |
| Stripe webhook signing secrets | webhook Lambdas | `<prefix>/stripe-webhook-secret`, `stripe-billing-webhook-secret` |

- **Terraform** writes Stripe webhook signing secrets; Stripe API key for Lambdas is set manually ([`stripe.md`](stripe.md)).
- **Origin verify** must be a plain **String** in SSM — CloudFront needs the literal at deploy time for the custom header.
- **Missing parameter:** places → `503`; fan-out skips web push; socket authorizer denies all connects.
- **Laptop:** Fallback env vars (e.g. `GOOGLE_MAPS_API_KEY`) when no parameter name is set — ignored in production.

VAPID public key and subject are non-secret environment values.

Hand-set deploy parameters (IdP, maps, allowlist): [`configuration.md`](configuration.md).

## Account separation

Staging and production use **separate AWS accounts** with the same stack names. A staging mistake cannot read production DynamoDB or IAM ([`ARCHITECTURE.md` — Stacks](ARCHITECTURE.md#stacks-and-accounts)).

## Known gaps and trade-offs

- **IdP secrets in synthesized template** — Some Cognito IdP credentials pass through CDK as `SecretValue.unsafePlainText`. Runtime reads already use Parameter Store where migrated; switching parameters to `SecureString` needs no code change for those paths.
- **Origin secret exposure** — Readable via `cloudfront:GetDistributionConfig` or `ssm:GetParameter`. Leak bypasses WAF path to WebSocket API only; **ticket still required**. Rotation = new SSM value + site deploy; brief connect failures possible during authorizer cache window.
- **No MFA; 8-character password minimum** on the pool today.
- **Stateful resources retained without backup** — User pool, DynamoDB table, media bucket, Terraform state bucket use `RemovalPolicy.RETAIN`. No point-in-time recovery on the table yet — protects against stack delete, not bad writes.
- **First deploy socket gap** — API stack before site stack: minutes where `x-origin-verify` is required but CloudFront does not send it.
- **Old native apps** — WebSocket still on `execute-api` until rebuilt for site hostname.
- **Stripe webhook URLs** — No CloudFront WAF; Stripe signature only ([`stripe.md`](stripe.md)).
- **WAF token rule** — Counts unverified bearer strings; mitigated by `PerIpFlood`.

## Local development

Local proxy skips CloudFront, OAC, WAF, and IAM on function URLs. Use **staging** to exercise edge controls; `infrastructure/lib/*.test.ts` synth-tests edge wiring. Never run `AUTH_PROVIDER=local` in production.

[`api.md` — Local development](api.md#local-development).

## Key files

| Path | Role |
| --- | --- |
| `functions/lib/auth/` | Cognito and local JWT verification |
| `functions/lib/guards.ts` | Membership and team guards |
| `functions/lib/permissions.ts` | Permission matrix |
| `functions/lib/entitlements.ts` | Plan gates |
| `functions/lib/parameters.ts` | SSM secret reads |
| `functions/socket/src/authorize.ts` | WebSocket `$connect` |
| `functions/lib/socket-ticket.ts` | Ticket mint/redeem |
| `infrastructure/lib/site-api.ts` | OAC, viewer auth rewrite |
| `infrastructure/lib/api-edge.ts` | WAF Web ACL |
| `infrastructure/lib/website.ts` | CSP and security headers |
| `infrastructure/lib/table-access.ts` | IAM leading keys |
| `lib/rules` | Minor and payer rules shared with client |

# GamePlan

Teams keep practices, games, and chat in one product. This repository is the Amazon Web Services (AWS) side of that
product: one Cloud Development Kit (CDK) app, one function per area, and a local stand-in that does not need a cloud
deploy.

The website and the phone apps are the same Expo app under `client/expo`. Day-to-day API work runs on the laptop.

## Local stack

Docker Compose runs DynamoDB Local, the API proxy (every area Lambda), and the Expo
website with live reload.

| Service    | URL                         |
| ---------- | --------------------------- |
| Website    | http://localhost:4200       |
| API proxy  | http://localhost:3000       |
| API docs   | http://localhost:3000/docs  |
| DynamoDB   | http://localhost:8000       |

```bash
npm run up
```

That starts DynamoDB, the API, and the website, and publishes the ports above.
`docker compose up --watch` syncs `functions/`, `local/`, `config/`, and `client/` into the
containers. The API restarts via `tsx watch`; the website reloads via `ng serve`.
Stop with `npm run down`.

### Breakpoints (API in Compose)

`npm run up` / `up:build` only starts Compose — it does not attach the debugger. After the
API is up and logs show `Debugger listening on ws://0.0.0.0:92xx/...`, set a breakpoint
under `functions/` or `local/`, then use **Run and Debug** → **Attach teams** (or the
matching area). **Attach API (all)** connects to every inspector at once.

Compose sets `NODE_INSPECT_HOST`. Each area runs under `tsx watch`, and `--inspect` is
passed to the child that runs the routes. A synced source edit restarts that child, and
the debugger reattaches when the launch config has `restart` set.

| Process  | Port |
| -------- | ---- |
| identity | 9229 |
| teams    | 9230 |
| schedule | 9231 |
| chat     | 9232 |
| media    | 9233 |
| places   | 9234 |
| socket   | 9235 |
| fanout   | 9236 |
| proxy    | 9237 |

Configs live in [`.vscode/launch.json`](.vscode/launch.json) (`localRoot` → `remoteRoot`
`/app`). Restart the API container (or re-run `npm run up`) after pulling changes that
add `NODE_INSPECT_HOST` so the inspectors bind.

After changing Dockerfiles or `package-lock.json`, rebuild images once:

```bash
npm run up:build
```

Compose builds separate images from [`local/Dockerfile.api`](local/Dockerfile.api) and
[`local/Dockerfile.client`](local/Dockerfile.client). Each rewrites root `workspaces` before
install so the API skips Angular and CDK, and the client installs only `lib/types` plus
`client/*` (no schemas, functions, or CDK). Filtered workspaces no longer match the full
lockfile, so the images use `npm install` (with a BuildKit npm cache mount) instead of
`npm ci`. Workspace `package.json` files are copied before source, so code-only edits keep
the install layer cached. Day-to-day `npm run up` does not pass `--build`; Compose Watch
syncs source without reinstalling.

Wire types for the client come from Zod schemas in [`lib/schemas`](lib/schemas).
`npm run generate:types` converts those schemas to JSON Schema, then writes plain TypeScript
into [`lib/types/src/generated/schema-types.ts`](lib/types/src/generated/schema-types.ts)
(also run by `npm run typecheck`). Edit schemas, regenerate, and commit the generated file
so the client image never needs the schemas package or Zod.

Live reload deliberately avoids **Chokidar** polling and bind-mounted watchers (`CHOKIDAR_USEPOLLING`,
`ng serve --poll`, nodemon `--legacy-watch`). Polling is slow under load and keeps CPU high. Compose
Watch copies edits into the container filesystem so `tsx watch` and Expo can use normal file
events instead.

Compose uses [`local/Dockerfile.client`](local/Dockerfile.client). A production website is
`npm run client:build`, which writes a static export to `client/expo/dist`.

### Laptop API without Compose for the app

Amazon DynamoDB (DynamoDB) Local can still run alone. Each area is its own Node.js process.
A proxy on port 3000 forwards a path prefix to that process.

| Prefix      | Area     | Port |
| ----------- | -------- | ---- |
| `/identity` | identity | 3101 |
| `/teams`    | teams    | 3102 |
| `/schedule` | schedule | 3103 |
| `/chat`     | chat     | 3104 |
| `/media`    | media    | 3105 |
| `/socket`   | socket   | 3106 |
| `/fanout`   | fanout   | 3107 |

From the repository root, with Node.js 22 (API only; DynamoDB in Docker):

1. `npm install`
2. `npm run db:up`
3. `npm run db:create`
4. `npm run db:seed` (wipes the local table down to the demo clubs: Peoria Pigs, Seacoast Men's Rugby)
5. `npm run dev`
6. `npm run client:start` (optional; or use `npm run up` for the full Compose stack)

`GET http://127.0.0.1:3000/identity/health` returns `{ "ok": true, "service": "identity" }`. The same path exists for
teams, schedule, chat, media, socket, and fanout.

`ws://127.0.0.1:3000/socket` is the local WebSocket. The cloud WebSocket expects the Amazon Cognito (Cognito) access
token as `?token=`, because a browser WebSocket cannot set an Authorization header.

### Identity and session

Local and deployed sign-in uses Cognito Hosted UI. Set these on the API process (Compose reads them
from `.env`):

- `COGNITO_USER_POOL_ID`
- `COGNITO_CLIENT_ID`
- `COGNITO_HOSTED_UI_DOMAIN`
- `COGNITO_REGION` (defaults to `us-east-1`)
- `AUTH_CALLBACK_URL` (`http://localhost:3000/identity/oauth/callback`)
- `CLIENT_ORIGIN`

Sign-in starts at `GET /identity/oauth/login` (PKCE → Hosted UI → `GET /identity/oauth/callback`).

The API entrypoint also seeds two demo clubs (idempotent): **Peoria Pigs** (`peoria-admin@localhost` /
`22222222-2222-4222-8222-222222222222`) and **Seacoast Men's Rugby** (`seacoast-admin@localhost` /
`44444444-4444-4444-8444-444444444444`).

Optional social IdP credentials can be passed as CDK context (`googleClientId` / `googleClientSecret`,
`facebookAppId` / `facebookAppSecret`, `appleClientId` / `appleTeamId` / `appleKeyId` / `applePrivateKey`).
They can also be attached in the Cognito console after deploy.

First social sign-in without a birthday redirects to `/complete-profile`. `POST /identity/profile/complete`
stores birthday and derives `accountKind`.

Client config is read from `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WS_BASE_URL`,
`EXPO_PUBLIC_AUTH_DISABLED`, and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`.
[`client/expo/scripts/run.mjs`](client/expo/scripts/run.mjs) copies `API_BASE_URL` and
`WS_BASE_URL` onto those names. Production builds require `API_BASE_URL` and set
`BUILD_CONFIGURATION=production`. The website uses Cognito sign-in. The native apps
redeem a one-time code from `POST /identity/oauth/exchange`.

Place autocomplete and reverse geocode use `GOOGLE_MAPS_API_KEY` on the **API**.
The interactive map uses `GOOGLE_MAPS_BROWSER_API_KEY` (web) and
`GOOGLE_MAPS_ANDROID_API_KEY` (Android). See [`docs/maps/README.md`](docs/maps/README.md).

| Method | Path                            | Notes                                              |
| ------ | ------------------------------- | -------------------------------------------------- |
| `GET`  | `/identity/oauth/login`         | Start Cognito Hosted UI                           |
| `GET`  | `/identity/oauth/callback`      | Code exchange; sets refresh cookie; redirects      |
| `GET`  | `/identity/oauth/logout`        | Clear cookie and redirect to Cognito logout       |
| `POST` | `/identity/oauth/exchange`      | Redeem a native handoff code for a session        |
| `POST` | `/identity/profile/complete`    | Birthday + display name after social sign-in       |
| `POST` | `/identity/register`            | Email/password (tests / legacy); stores `accountKind` |
| `POST` | `/identity/login`               | Email/password session                             |
| `POST` | `/identity/refresh`             | Cookie and/or `{ "refreshToken" }` body            |
| `POST` | `/identity/logout`              | Clears the refresh cookie                          |
| `GET`  | `/identity/me`                  | Bearer access token; returns the profile           |

Both clients send the **access token** as `Authorization: Bearer …`.

- **Website:** identity sets an HttpOnly `ts_refresh` cookie. Refresh calls use `credentials: 'include'` and omit the
  body token. The `@gameplan/client-session` package uses `WebRefreshStore` for this path.
- **Capacitor:** send `X-Refresh-Delivery: body` so the refresh token is also returned in JSON. Store it with
  `CapacitorRefreshStore` (Preferences). Refresh sends that token in the body.

### Teams

Adults create a team (and its default chat) in one write. Roster joins use an invite code or an approved join
request. The admin screen updates the team name, time zone, and location, and reads and writes the role-permission
matrix. A minor cannot create a team, cannot be `team_admin`, and cannot hold `manage_permissions`.

| Method  | Path                                              | Notes                                      |
| ------- | ------------------------------------------------- | ------------------------------------------ |
| `POST`  | `/teams`                                          | Create team + default chat; caller is admin |
| `GET`   | `/teams`                                          | Teams the caller belongs to                |
| `GET`   | `/teams/directory?q=`                             | Name-prefix search for join autocomplete   |
| `GET`   | `/teams/:teamId`                                  | Team details for a member                  |
| `PATCH` | `/teams/:teamId`                                  | Update name, time zone, and location (`manage_permissions`) |
| `GET`   | `/teams/:teamId/members`                          | Roster                                     |
| `PATCH` | `/teams/:teamId/members/:userId`                  | Assign role (`assign_roles`)               |
| `GET`   | `/teams/:teamId/permissions`                      | Role-permission matrix                     |
| `PUT`   | `/teams/:teamId/permissions`                      | Replace matrix (`manage_permissions`)      |
| `POST`  | `/teams/:teamId/invites`                          | Create invite code (`invite_members`)      |
| `GET`   | `/teams/:teamId/invites`                          | List invites (`invite_members`)            |
| `GET`   | `/teams/invite/:code`                             | Preview invite from a shared code          |
| `POST`  | `/teams/invite/:code/accept`                      | Join via invite                            |
| `POST`  | `/teams/:teamId/join-requests`                    | Request to join                            |
| `GET`   | `/teams/:teamId/join-requests`                    | List requests (`approve_join_requests`)    |
| `POST`  | `/teams/:teamId/join-requests/:id/approve`        | Approve and assign role                    |
| `POST`  | `/teams/:teamId/join-requests/:id/reject`         | Reject a request                           |

Teams routes require a bearer access token (or Cognito JWT claims from API Gateway in the cloud).

### Schedule

Practices and games live on the team partition. Recurrence stays on the event row and is expanded
for a visible window (capped at about three months). Each occurrence has its own RSVP. Creating or
editing an event requires `manage_events`; every member can read the schedule and RSVP.

| Method  | Path                                          | Notes                                         |
| ------- | --------------------------------------------- | --------------------------------------------- |
| `GET`   | `/schedule/teams/:teamId?from=&to=`           | Expand occurrences and attach RSVPs           |
| `POST`  | `/schedule/teams/:teamId/events`              | Create practice or game (`manage_events`)     |
| `GET`   | `/schedule/teams/:teamId/events/:eventId`     | Event definition                              |
| `PATCH` | `/schedule/teams/:teamId/events/:eventId`     | Edit practice or game (`manage_events`)       |
| `PUT`   | `/schedule/teams/:teamId/rsvps`               | Upsert RSVP for one occurrence                |

Schedule routes require a bearer access token (or Cognito JWT claims from API Gateway in the cloud).

### Chat

Chats are listed from the caller's memberships. Creating a team channel needs
`create_team_channels` and adds the current roster. Private chats are not gated by that
permission; the minor chat rule still applies. Adult search is exact email on the EmailIndex
and returns adults only under the v1 search policy. Sending a message writes the row, then
enqueues fan-out.

| Method | Path                         | Notes                                              |
| ------ | ---------------------------- | -------------------------------------------------- |
| `GET`  | `/chat`                      | Chats the caller belongs to                        |
| `POST` | `/chat/channels`             | Create a team channel (`create_team_channels`)     |
| `POST` | `/chat/private`              | Create a private chat with one or more other people |
| `GET`  | `/chat/users/search?email=`  | Exact-email adult search                           |
| `GET`  | `/chat/:chatId/messages`     | Newest-first history (`limit`, `cursor`)           |
| `POST` | `/chat/:chatId/messages`     | Persist a message and enqueue fan-out              |

Chat routes require a bearer access token (or Cognito JWT claims from API Gateway in the cloud).

### Realtime

The WebSocket is delivery only. Clients send messages over HTTP. On `$connect` the
socket Lambda stores `CONN#` under the user partition (with a time-to-live). Chat and
schedule enqueue a fan-out job after they write. Fan-out posts to open sockets; if a
person has none, it publishes to the push topic using registered device tokens.

Locally, chat and schedule `POST` to `/fanout/deliver`. Fan-out then posts to
`http://127.0.0.1:3106/@connections/{id}` on the socket process.

Connect with `ws://127.0.0.1:3000/socket?token=<accessToken>`.

### Media and devices

Presigned Amazon Simple Storage Service (S3) upload and download keep file bytes out of
Lambda. The default size cap is 15 MB. Device tokens live on the user partition so
fan-out can push when no socket is open. On the laptop, DynamoDB Local mode stores
objects in memory behind `/media/local-objects/…`.

| Method   | Path                              | Notes                                      |
| -------- | --------------------------------- | ------------------------------------------ |
| `POST`   | `/media/presign-upload`           | Returns `uploadUrl`, `objectKey`, `maxBytes` |
| `GET`    | `/media/presign-download?objectKey=` | Short-lived download URL                |
| `PUT`    | `/media/devices/:deviceId`        | Register push token (`ios` / `android` / `web`) |
| `DELETE` | `/media/devices/:deviceId`        | Remove a device token                      |

## Client

The Expo app lives in `client/expo`. Schedule, chats, and teams share one Router
tree on web, iOS, and Android. Store binaries are built with `expo prebuild` and
the native toolchains (or GitHub Actions); this repo does not keep a Capacitor shell.

Shared wire types live in [`lib/types`](lib/types) (`@gameplan/types`). Zod
request schemas live in [`lib/schemas`](lib/schemas) (`@gameplan/schemas`). API
functions import schemas for validation; the Expo app imports generated types only.

```bash
npm run client:start
```

## Cloud

`npm run synth` prints the AWS CloudFormation (CloudFormation) template for `GamePlanStack`.

Staging and production are the same stack in **separate AWS accounts**. Resource names stay
`GamePlanStack` in both. GitHub Actions deploys them:

| Workflow | When |
| --- | --- |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Pull requests and pushes to `master`. Typecheck and tests. No AWS credentials. |
| [`.github/workflows/deploy-api.yml`](.github/workflows/deploy-api.yml) | Push to `master` deploys the **staging** environment. A published GitHub release deploys **production**. |
| [`.github/workflows/deploy-client.yml`](.github/workflows/deploy-client.yml) | Same triggers. Builds the Angular site and syncs it to the site bucket. |

The API and client workflows are independent. Re-run either from the Actions tab (`workflow_dispatch` chooses `staging` or `production`).

### Parameter Store

Both accounts use the same prefix, `/gameplan/` (override with the `SSM_PREFIX` environment variable). Every parameter is a **String**. GitHub does not store these values. Each GitHub environment (`staging`, `production`) has one secret, `AWS_ROLE_ARN`, and optional variables `AWS_REGION` (default `us-east-1`) and `SSM_PREFIX` (default `/gameplan`).

| Name | Used for |
| --- | --- |
| `client-origin` | Browser origin for CORS and OAuth redirects (`CLIENT_ORIGIN`) |
| `callback-urls` | Comma-separated Cognito callback URLs |
| `logout-urls` | Comma-separated Cognito logout URLs |
| `google-client-id`, `google-client-secret` | Optional Google IdP |
| `facebook-app-id`, `facebook-app-secret` | Optional Facebook IdP |
| `apple-client-id`, `apple-team-id`, `apple-key-id`, `apple-private-key` | Optional Apple IdP. Store the PEM, including line breaks. |
| `google-maps-api-key` | Places Lambda |
| `google-maps-browser-api-key` | Website map |
| `api-base-url`, `ws-base-url`, `site-bucket-name`, `site-distribution-id`, `site-url` | Written by the API workflow after deploy. The client workflow reads the API URL, bucket, and distribution id. |

An identity provider is created only when every field for that provider is set. CDK context still overrides these environment variables for a local `cdk deploy`.

Before the first API deploy in an account, set `client-origin`, `callback-urls`, and `logout-urls`. If you do not know the CloudFront or API Gateway host yet, use placeholders, deploy, then copy `HttpApiUrl` into `callback-urls` and `SiteUrl` into `client-origin` and `logout-urls` and deploy the API again. Those hosts do not change on later deploys. The client workflow fails until `api-base-url`, `site-bucket-name`, and `site-distribution-id` exist.

### One-time account setup

In each account:

1. `npx cdk bootstrap` from `infrastructure/` (the CDK toolkit stack).
2. Add the GitHub OpenID Connect (OIDC) provider `token.actions.githubusercontent.com` (audience `sts.amazonaws.com`).
3. Create a deploy role trusted only for this repository’s GitHub environment:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:<owner>/<repo>:environment:staging"
    }
  }
}
```

Use `environment:production` on the production account’s role. Give the role CloudFormation deploy rights for this stack (including the roles CDK creates) plus `ssm:GetParametersByPath` and `ssm:PutParameter` on `/gameplan/*`. Parameter Store Strings do not need a KMS decrypt permission. Store that role ARN as the `AWS_ROLE_ARN` secret on the matching GitHub environment. Protect **production** with required reviewers.

The stack creates:

- A Cognito user pool with Hosted UI (email/password plus optional Google / Apple / Facebook IdPs from CDK context or Parameter Store).
  OAuth callback URLs default to the identity BFF (`/identity/oauth/callback`).
- One DynamoDB table, `gameplan`, with partition key `PK` and sort key `SK`. Billing is on-demand.
- **EmailIndex** on `email`, for an exact-email lookup that cannot start from a user partition.
- **ConnectionIndex** on `connectionId`, so WebSocket `$disconnect` can find the user item. Both indexes project keys
  only.
- A time-to-live attribute, `ttl`, for socket rows.
- A private Amazon Simple Storage Service (S3) bucket for message files, and a second bucket plus Amazon CloudFront
  (CloudFront) for the static website.
- An Amazon API Gateway HTTP API. `GET /{area}/health` is open. Identity routes stay open so Hosted UI OAuth,
  register, and login can run before a token exists. The other areas require a Cognito access token.
- An API Gateway WebSocket API. `$connect` checks that same access token. The socket is delivery only.
- A queue from chat and schedule to the fan-out function, and an Amazon Simple Notification Service (SNS) topic the
  fan-out function publishes to when a recipient has no open socket.

Functions stay out of a virtual private cloud. They do not call each other.

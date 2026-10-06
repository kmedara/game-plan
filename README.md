# GamePlan

Teams keep practices, games, and chat in one product. This repository is the Amazon Web Services (AWS) side of that
product: one Cloud Development Kit (CDK) app, one function per area, and a local stand-in that does not need a cloud
deploy.

The website and the phone apps are the same Angular app under `client/app`. Day-to-day API work runs on the laptop.

## Local stack

Docker Compose runs DynamoDB Local, the API proxy (every area Lambda), and the Angular
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
| socket   | 9234 |
| fanout   | 9235 |
| proxy    | 9236 |

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
Watch copies edits into the container filesystem so `tsx watch` and `ng serve` can use normal file
events instead.

The static nginx client image ([`client/app/Dockerfile`](client/app/Dockerfile)) remains available
for a production-like preview. Compose uses [`local/Dockerfile.client`](local/Dockerfile.client).

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

Local Compose sets **`AUTH_DISABLED=true`** and **`AUTH_SEED_USER_ID`** (required whenever auth is
disabled). Identity skips Cognito and issues a session for that existing profile id — Compose
defaults to the Seacoast Men's Rugby admin. `POST /identity/refresh` and `GET /identity/me` issue
that seed session without Cognito env vars. The API entrypoint also seeds two demo clubs
(idempotent): **Peoria Pigs** (`peoria-admin@localhost` /
`22222222-2222-4222-8222-222222222222`) and **Seacoast Men's Rugby** (`seacoast-admin@localhost` /
`44444444-4444-4444-8444-444444444444`). Change `AUTH_SEED_USER_ID` to either admin id to Continue
into that club.

To exercise real Cognito Hosted UI locally (Google / Apple / Facebook / email once IdPs are wired):

1. Deploy `GamePlanStack` (or point at an existing pool)
2. Set `AUTH_DISABLED=false` on the API **and** the client Compose service
3. Set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_HOSTED_UI_DOMAIN`, `COGNITO_REGION`,
   `AUTH_CALLBACK_URL` (`http://localhost:3000/identity/oauth/callback`), and `CLIENT_ORIGIN`
4. Sign-in starts at `GET /identity/oauth/login` (PKCE → Hosted UI → `GET /identity/oauth/callback`)

Optional social IdP credentials can be passed as CDK context (`googleClientId` / `googleClientSecret`,
`facebookAppId` / `facebookAppSecret`, `appleClientId` / `appleTeamId` / `appleKeyId` / `applePrivateKey`).
They can also be attached in the Cognito console after deploy.

First social sign-in without a birthday redirects to `/complete-profile`. `POST /identity/profile/complete`
stores birthday and derives `accountKind`.

Client config is written at start/build from environment variables by
[`client/app/scripts/write-environment.mjs`](client/app/scripts/write-environment.mjs)
(`API_BASE_URL`, optional `WS_BASE_URL`, `AUTH_DISABLED`). Production builds require `API_BASE_URL`
and set `BUILD_CONFIGURATION=production`. When `AUTH_DISABLED=true`, the API also needs
`AUTH_SEED_USER_ID`.

| Method | Path                            | Notes                                              |
| ------ | ------------------------------- | -------------------------------------------------- |
| `GET`  | `/identity/oauth/login`         | Start Hosted UI (or seed session when auth disabled) |
| `GET`  | `/identity/oauth/callback`      | Code exchange; sets refresh cookie; redirects      |
| `GET`  | `/identity/oauth/logout`        | Clear cookie; Cognito logout when enabled          |
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

The Angular app lives in `client/app`. Schedule is the home screen, with a team
switcher, chats, and the team permission matrix. Capacitor projects for iOS and
Android are under `client/app/ios` and `client/app/android`.

Shared wire types live in [`lib/types`](lib/types) (`@gameplan/types`). Zod
request schemas live in [`lib/schemas`](lib/schemas) (`@gameplan/schemas`). API
functions import schemas for validation; the Angular app imports generated types only.

```bash
npm start -w @gameplan/app
```

See [client/app/README.md](client/app/README.md) for Capacitor sync and store push setup.

## Cloud

`npm run synth` prints the AWS CloudFormation (CloudFormation) template for `GamePlanStack`.

The stack creates:

- A Cognito user pool with Hosted UI (email/password plus optional Google / Apple / Facebook IdPs from CDK context).
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

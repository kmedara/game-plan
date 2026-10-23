# GamePlan

Teams keep practices, games, and chat in one product. One CDK app, one Lambda per area, and an Expo app for the website and the phones.

Day-to-day work runs on the laptop. Design and cloud detail live in [ARCHITECTURE.md](ARCHITECTURE.md).

## Run locally

`npm run up` starts DynamoDB, the API, and the website. `npm run down` stops them. Compose Watch syncs source into the containers; the API restarts and the website reloads. After a Dockerfile or lockfile change, run `npm run up:build` once.

| Service   | URL                        |
| --------- | -------------------------- |
| Website   | http://localhost:4200      |
| API proxy | http://localhost:3000      |
| API docs  | http://localhost:3000/docs |
| DynamoDB  | http://localhost:8000      |

`GET http://127.0.0.1:3000/identity/health` returns `{ "ok": true, "service": "identity" }`. The same path exists for teams, schedule, chat, media, socket, and fanout.

Startup seeds two demo clubs: Peoria Pigs and Seacoast Men's Rugby. `npm run db:seed` wipes the local table down to those clubs.

To run the API on the host instead of Compose: `npm install`, `npm run db:up`, `npm run db:create`, `npm run db:seed`, `npm run dev`. Add `npm run client:start` for the website.

| Prefix      | Area     | Port |
| ----------- | -------- | ---- |
| `/identity` | identity | 3101 |
| `/teams`    | teams    | 3102 |
| `/schedule` | schedule | 3103 |
| `/chat`     | chat     | 3104 |
| `/media`    | media    | 3105 |
| `/places`   | places   | 3106 |
| `/socket`   | socket   | 3107 |
| `/fanout`   | fanout   | 3108 |
| `/payments` | payments | 3109 |
| `/billing`  | billing  | 3110 |
| `/orgs`     | orgs     | 3111 |

The local WebSocket is `ws://127.0.0.1:3000/socket?ticket=`. The cloud URL is `wss://<site host>/api/socket`. Mint the ticket with `POST /identity/socket-ticket`.

## Debug the API

`npm run up` does not attach a debugger. When the API logs `Debugger listening`, use **Run and Debug** → **Attach teams** (or the matching area). **Attach API (all)** connects to every inspector. Configs are in [`.vscode/launch.json`](.vscode/launch.json).

| Process  | Port | Process | Port |
| -------- | ---- | ------- | ---- |
| identity | 9229 | media   | 9233 |
| teams    | 9230 | places  | 9234 |
| schedule | 9231 | socket  | 9235 |
| chat     | 9232 | fanout  | 9236 |
| payments | 9237 | billing | 9238 |
| orgs     | 9239 | proxy   | 9240 |

## Sign in

Compose reads Cognito settings from `.env`:

- `COGNITO_USER_POOL_ID`
- `COGNITO_CLIENT_ID`
- `COGNITO_HOSTED_UI_DOMAIN`
- `COGNITO_REGION` (default `us-east-1`)
- `AUTH_CALLBACK_URL` (`http://localhost:4200/api/identity/oauth/callback`)
- `CLIENT_ORIGIN`

Sign-in starts at `GET /identity/oauth/login`. Without those variables the API rejects every token. Fully offline work sets `AUTH_PROVIDER=local` and `LOCAL_JWT_SECRET`. That mode is refused when `NODE_ENV=production`.

The website keeps the refresh token in an HttpOnly cookie. The phone app sends `X-Refresh-Delivery: body` and stores the token in secure storage. Both send the access token as `Authorization: Bearer`.

Maps setup is in [docs/maps/README.md](docs/maps/README.md). Interactive route docs are in [docs/api-docs.md](docs/api-docs.md).

## Repo

- `client/expo` — website, iOS, and Android. `npm run client:start` for dev, `npm run client:build` for the static export. Store builds and review are in [docs/store-release.md](docs/store-release.md).
- `lib/schemas` — Zod contracts. `npm run generate:types` writes `lib/types` (also part of `npm run typecheck`). Commit the generated file.
- `functions/<area>` — one Lambda per area. Areas share the table and do not call each other.

## Cloud

`npm run synth` prints the CloudFormation templates. Staging and production are the same four stacks in separate accounts: `GamePlanDns`, `GamePlanPlatform`, `GamePlanApi`, `GamePlanSite`.

| Workflow | When |
| -------- | ---- |
| [ci.yml](.github/workflows/ci.yml) | Pull requests and pushes to `master`. Typecheck and tests. |
| [deploy.yml](.github/workflows/deploy.yml) | Push to `master` updates staging. A GitHub release updates production. |

The deploy job runs `cdk deploy --all`, applies the Stripe and Expo Terraform ([infrastructure/terraform](infrastructure/terraform/README.md)), builds the Expo site, syncs the bucket, and invalidates CloudFront. Re-run it from the Actions tab to choose `staging` or `production`.

Each GitHub environment has three secrets: `AWS_ROLE_ARN`, `STRIPE_API_KEY` (test mode for staging, live for production), and `EXPO_TOKEN`. Hostnames are `https://<environment>.example.com`, with the API at `/api` and the socket at `wss://<environment>.example.com/api/socket`. Parameter Store inputs are listed under **Secrets at run time** in [ARCHITECTURE.md](ARCHITECTURE.md).

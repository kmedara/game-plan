# Client (Expo)

One Expo Router app ships the **website** (static export), **iOS**, and **Android**. Maps, the day field, and the time clock use platform splits (`.native.tsx`). Product architecture for domains the app displays stays in [`ARCHITECTURE.md`](ARCHITECTURE.md#stack); this doc is structure, cache, session usage, and performance.

| | Choice | Main cost |
| --- | --- | --- |
| Platforms | One codebase, three targets | Website bundle is heavier than a web-only app |
| Data | TanStack Query, persisted per user | Roster and schedule can sit in website storage until sign-out |
| Contracts | Generated types from `lib/types` only | No Zod or server imports in the app |
| Web delivery | Static export behind CloudFront | First route download + full invalidation on deploy today |

## Repository layout

| Path | Role |
| --- | --- |
| `client/expo` | Screens, navigation (`app/`), UI helpers, TanStack Query layer |
| `client/session` | Access token, refresh, and **request signing** (body hash + headers) for every platform |
| `lib/types`, `lib/rules` | Shared types and pure rules (`canWithRoles`, entitlements helpers, minors) |

The client and API meet only through `lib/*`. The client does not import Zod or `functions/*`.

Dev: `npm run client:start`. Production web export: `npm run client:build`. Store builds: [store-release.md](store-release.md).

## Session and API calls

Session behavior is shared across web and native (`client/session`):

- **Access token** stays in memory on the website (not `localStorage`).
- **Website refresh** uses an HttpOnly cookie on `/api/identity`; **native** uses SecureStore and `X-Refresh-Delivery: body`, with OAuth completing via `gameplan://auth`.
- **One refresh in flight** — `SessionService.refresh()` dedupes concurrent `POST /identity/refresh` calls; TanStack does not retry `unauthorized`.
- **Writes through CloudFront** send `x-amz-content-sha256` (`withContentHash`); React Native has no Web Crypto digest, so SHA-256 is implemented in TypeScript.

Server-side auth and OAuth BFF: [`security.md` — Authentication](security.md#authentication-and-sessions).

## Client cache

Screens load through **TanStack Query**. Keys, query functions, and cache writes live in `client/expo/src/queries/`. Screens do not fetch in `useEffect`.

- **Defaults.** `createQueryClient` reuses a value for 30 seconds and retries only `TypeError` or `http_5xx`, at most twice. `queryKeys` is the only place a cache entry is named.
- **Permissions.** `useTeamAccess` reads `permissionsQuery` for 60 seconds. A save writes the returned rows back. The check is `canWithRoles` from `lib/rules`, the same function as `requirePermission`.
- **Live events.** The signed-in shell prepends `chat_message` onto a thread that is already loaded, skips duplicates, and does not invent a one-message page. Schedule and join-request events invalidate that team's prefix. Socket wiring and event types: [`realtime.md`](realtime.md).
- **Pull to refresh.** The shell refetches every query a mounted screen is subscribed to. It does not keep a list of keys. A value that is only in the cache, with no subscriber, stays put. A screen still mounted underneath the visible one reloads too.
- **Offline writes.** Most mutations use `networkMode: 'always'` and fail immediately offline. RSVP, carpool, and lineup use `online`, pause while disconnected, and resume after relaunch. Chat sends are not queued.
- **Connectivity.** Unknown NetInfo (`null`) counts as online so launch does not flash offline. Only a definite `false` pauses. On iOS and Android, returning to the foreground refetches stale queries and reconnects the socket. The website uses `visibilitychange`.
- **Persistence.** Successful queries of known kinds (profile, teams, roster, permissions, schedule, chat list) stay in AsyncStorage for 24 hours. Presigned URLs, message history, directory pages, and invite previews are left out. The refresh token stays in SecureStore or the HttpOnly cookie. Restore waits until the session user is known and uses that id as the persist buster, so another account's data is discarded. Sign-out clears memory and storage.
- **Calendar and brand.** The schedule merges every membership for the visible month in the device time zone. Each event type has one fixed color (`EVENT_TYPE_COLORS` in `client/expo/src/theme.ts`): the stripe on its row, the dot beside its label, the picker, and the calendar's day dots, one per type present that day. Fixed rather than team colors, so a type reads the same across teams; the team is shown by name and logo instead. The colors avoid the brand green and error red and keep 3:1 contrast on the row and card backgrounds (checked in `theme.test.ts`). One membership brands the shell. Several memberships stay on the default colors until the athlete opens a team, event, or chat. There is no team switcher. A carpool claim opens one private chat for that car; later riders join it; an empty car deletes it. A minor rider's guardian is added.

- **Cost:** AsyncStorage is `localStorage` on the website, so roster and schedule can remain on disk until sign-out. That is product data, not tokens.
- **Open:** chat history is one page, and an offline send is not replayed. `useInfiniteQuery` (already used for directory search) and a persisted send would close that without a new cache.

## Bundle size and latency

### App bundle

- The client never ships Zod. The Docker image does not install `lib/schemas`.
- `.native.tsx` keeps `react-native-maps` and the native date picker out of the web bundle. The web map injects the Maps script only when a map is shown. `expo-notifications` loads when push registration runs.
- Web routes use **async routes**. The first visit downloads the shell plus the current route. Native production stays **eager** so a store build does not suspend on navigation.
- Inspect the static export: `npm run inspect:client`.

**Open:** both `en.json` and `es.json` ship in the main bundle. `"output": "static"` would prerender login HTML once every screen can render without `window`.

### API round trips (client-visible)

These server choices affect what the app waits on:

- `GET /teams/:teamId/members` returns photo key, positions, and phone (a minor's phone only for that minor and their guardians), so an event screen is one roster read.
- Writes return when DynamoDB has the row; live updates arrive later over the socket or push ([`realtime.md`](realtime.md)).
- Media bytes use presigned URLs from the API; uploads and downloads go to S3/CloudFront, not through Lambda.
- The API runs in `us-east-1`. Users far from that region pay RTT on every call unless the product adds edge or regional strategy later.

Server bundle and cold-start notes: [`api.md` — Bundle size and latency](api.md#bundle-size-and-latency).

### Website delivery (CloudFront)

Static assets are served from the same hostname as `/api` ([`dns-and-hosting.md`](dns-and-hosting.md)). Edge caching uses `CACHING_OPTIMIZED` for files; `/api` is not cached.

**Open:** deploy syncs the site without per-object `Cache-Control`, then invalidates `/*`. Hashed assets should be `public, max-age=31536000, immutable` and `index.html` `no-cache` so routine deploys need not blow the full edge cache.

## Key files

| Path | Role |
| --- | --- |
| `client/expo/app/_layout.tsx` | Shell, session, query client, live socket |
| `client/expo/src/query-client.ts` | TanStack defaults and persistence |
| `client/expo/src/queries/` | Keys, fetchers, cache helpers |
| `client/expo/src/state.tsx` | Signed-in context |
| `client/session/src/session-service.ts` | Token refresh and signed fetch |
| `client/expo/src/plan.ts` | `teamEntitlements`, upgrade UX |

---
name: Join request push
overview: Notify members who can approve join requests on iOS, Android, and web when someone asks to join a team, using the existing fan-out queue and actually delivering the notification.
todos:
  - id: job
    content: Add join_requested fan-out job and enqueue it from createJoinRequest
    status: completed
  - id: recipients
    content: Deliver only to members with approve_join_requests, including when a socket is open
    status: completed
  - id: native
    content: Register Expo push tokens and send iOS/Android through Expo
    status: completed
  - id: web
    content: Register a Web Push subscription and send it with VAPID from fan-out
    status: completed
isProject: false
---

# Join-request push

Today a join request only writes a `JOIN#` row in [`functions/teams/src/team-store.ts`](functions/teams/src/team-store.ts). Fan-out already sends `schedule_changed` and `chat_message` over the socket, then publishes device tokens to the `gameplan-push` SNS topic. Nothing subscribes to that topic, and [`client/expo/src/push.ts`](client/expo/src/push.ts) skips web, so no platform currently receives a notification.

## Who gets it

After `createJoinRequest` succeeds, enqueue a new fan-out job `join_requested` with `teamId`, `requestId`, team name, and the requester’s display name.

Recipients are team members whose role includes `approve_join_requests` on that team’s permission matrix (defaults: team admins only; a coach granted the permission is included). Use the same matrix lookup as [`functions/lib/permissions.ts`](functions/lib/permissions.ts). Do not notify the requester.

Send the push even when a socket is open. No screen turns a live frame into an alert, so the existing “socket instead of push” rule would hide this notification. Still post the job on open sockets so the admin screen can refresh later.

Copy: `{name} asked to join {team}`.

## Delivery

Fan-out sends the notification itself.

- **iOS and Android:** register an Expo push token (`getExpoPushTokenAsync`) instead of the raw device token, and POST to Expo’s push API from [`functions/fanout/src/deliver.ts`](functions/fanout/src/deliver.ts). Add an EAS `projectId` in [`client/expo/app.json`](client/expo/app.json).
- **Web:** register a Web Push subscription (service worker + `PushManager`) and store it as a `web` device whose token is the subscription JSON. Fan-out sends it with VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` on the fan-out Lambda; the public key is available to the web client).

`web` is already a value on `DEVICE_PLATFORMS`. The teams Lambda needs `FANOUT_QUEUE_URL` and `sqs:SendMessage` in [`infrastructure/lib/api.ts`](infrastructure/lib/api.ts), which only chat and schedule have today.

## Schema and tests

Add the `join_requested` variant to [`lib/schemas/src/fanout.ts`](lib/schemas/src/fanout.ts) and regenerate schema types. Cover recipient filtering, the enqueue from `createJoinRequest`, and that web/Expo payloads are built. Skip the real Expo and Web Push HTTP calls in tests.

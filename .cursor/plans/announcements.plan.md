---
name: Announcements
overview: Let a coach post a short notice to the whole team, with a push, and show the latest notices on the team page.
todos:
  - id: api
    content: Add announcement schemas, Dynamo key, fan-out job, and list and create routes
    status: pending
  - id: ui
    content: Show the latest announcements and a compose box on the team page
    status: pending
  - id: tests
    content: Cover list, create, and push delivery in handler tests, plus English and Spanish strings
    status: pending
isProject: false
---

# Announcements

An announcement is a short notice from someone who can manage events. It is not a chat message and it is not tied to one event. Every current member can read it. Creating one pushes the whole roster, even when the app is open. No new permission: reuse `manage_events`.

## Stored row

One item on the team partition, `ANNOUNCEMENT#<createdAt>#<announcementId>`, so a prefix query returns the newest first. The item holds `body` (1–500 characters), `createdBy`, and `createdAt`. There is no edit and no delete in this pass. The list route returns the latest 20.

Schemas live in [lib/schemas/src/teams.ts](lib/schemas/src/teams.ts) and the OpenAPI map. Regenerate [lib/types/src/generated/schema-types.ts](lib/types/src/generated/schema-types.ts). The key helper sits next to the other team sort keys in [functions/lib/dynamo/keys.ts](functions/lib/dynamo/keys.ts).

## Fan-out

Add `announcement` to [lib/schemas/src/fanout.ts](lib/schemas/src/fanout.ts): `teamId`, `announcementId`, `teamName`, `body`, `createdAt`. In [functions/fanout/src/deliver.ts](functions/fanout/src/deliver.ts), deliver it on the team socket and push it even when a socket is open, the same way `event_moved` does. The push title is the team name. The push body is the announcement text. Recipients are the current roster.

## Routes

Both require team membership. A team with no announcements returns an empty list.

- `GET /teams/:teamId/announcements`
- `POST` the same path with `{ body }`. Requires `manage_events`. Writes the row, enqueues `announcement`, and returns the stored item.

## Team page

On [client/expo/app/(main)/teams/[teamId].tsx](<client/expo/app/(main)/teams/[teamId].tsx>), show the latest announcements with the author name and the time. A member who can `manage_events` gets a text box and a post button. An open app on that team refreshes the list when the `announcement` socket event arrives. Strings go in [client/expo/src/en.json](client/expo/src/en.json) and [client/expo/src/es.json](client/expo/src/es.json).

Handler tests: empty list, a member without `manage_events` gets 403 on create, a create returns the body and enqueues one `announcement` job, and fan-out pushes that job even when the recipient has an open socket.

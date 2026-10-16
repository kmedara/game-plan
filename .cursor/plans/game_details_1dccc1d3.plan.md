---
name: Game details
overview: Add opponent, home or away, score, and a recap for each game date, stored per occurrence the way lineups are, and shown on the event sheet and the day list.
todos:
  - id: api
    content: Add game-detail schemas, Dynamo key, and GET/PUT routes for game occurrences
    status: pending
  - id: ui
    content: Show opponent, side, score, and recap on the game sheet and a short line on the day list
    status: pending
  - id: tests
    content: Cover the routes in handler tests and add English and Spanish strings
    status: pending
isProject: false
---

# Game details

Only games get these fields. Practices, meetings, and other events stay as they are. Each game date has its own details, because a repeating game has a different opponent and score each week. The identity matches a lineup: `eventId` plus `occurrenceStartsAt`.

## Stored row

One item on the team partition, `GAME#<occurrenceStartsAt>#<eventId>`, next to `lineupSk` in [functions/lib/dynamo/keys.ts](functions/lib/dynamo/keys.ts).

- `opponent`: optional, 1–80 characters
- `side`: `home` or `away`
- `ourScore` and `theirScore`: optional integers from 0 to 999, both present or both omitted
- `recap`: optional, up to 2,000 characters

Schemas go in [lib/schemas/src/schedule.ts](lib/schemas/src/schedule.ts) and the OpenAPI map. Regenerate [lib/types/src/generated/schema-types.ts](lib/types/src/generated/schema-types.ts).

## Routes

Same guards as the lineup in [functions/schedule/src/routes/lineup.ts](functions/schedule/src/routes/lineup.ts).

- `GET /schedule/teams/:teamId/game?eventId&occurrenceStartsAt` — any member. A missing row is an empty game (no opponent, no score, no recap).
- `PUT` the same path — `manage_events`. The body replaces the whole record. `not_a_game` for any other event type, and `occurrence_not_found` when that instant is not a real date.

The month query in [functions/schedule/src/schedule-store.ts](functions/schedule/src/schedule-store.ts) already loads RSVPs for the visible window. Load game rows the same way and attach `opponent`, `side`, and the two scores onto each game occurrence. The recap stays off the list and loads with the sheet.

## Sheet and day list

On a game, [client/expo/app/(main)/schedule/index.tsx](<client/expo/app/(main)/schedule/index.tsx>) shows a Game section above the lineup. Members with `manage_events` edit opponent, home or away, both scores, and the recap, then save. Everyone else sees the filled fields. A game with no details yet shows nothing in that section for readers.

The day row shows `vs {opponent}` when an opponent is set, and `ourScore–theirScore` when both scores are set.

Strings in [client/expo/src/en.json](client/expo/src/en.json) and [client/expo/src/es.json](client/expo/src/es.json). Handler tests follow the lineup cases: empty get, put and get, forbidden without `manage_events`, a practice rejected with `not_a_game`, and a score pair that is only half filled rejected.

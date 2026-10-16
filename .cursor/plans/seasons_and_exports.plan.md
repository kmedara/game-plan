---
name: Seasons and exports
overview: Let a team name a date range as a season and download that range as a calendar file or a spreadsheet.
todos:
  - id: api
    content: Add season schemas, Dynamo keys, and season and export routes
    status: pending
  - id: ui
    content: Show seasons on the team page and an export action on the schedule
    status: pending
  - id: tests
    content: Cover create, list, and both export formats in handler tests, plus English and Spanish strings
    status: pending
isProject: false
---

# Seasons and exports

A season is a name and a date range on a team, such as Fall 2026. It does not own events. Export walks the events the team already has and keeps occurrences whose start falls inside the range. No new permission: `manage_events` creates and edits seasons, and any member can export.

## Stored row

One item on the team partition, `SEASON#<seasonId>`. The item holds `name` (1–80 characters), `startsOn` and `endsOn` as `YYYY-MM-DD` in the team time zone, inclusive. `endsOn` must be on or after `startsOn`, and the span must be at most 366 days.

Schemas live in [lib/schemas/src/schedule.ts](lib/schemas/src/schedule.ts) and the OpenAPI map. Regenerate [lib/types/src/generated/schema-types.ts](lib/types/src/generated/schema-types.ts). The key helper sits next to `lineupSk` in [functions/lib/dynamo/keys.ts](functions/lib/dynamo/keys.ts).

## Routes

Membership is required. A team with no seasons returns an empty list.

- `GET /schedule/teams/:teamId/seasons`
- `POST` the same path with `{ name, startsOn, endsOn }`. Requires `manage_events`. Returns the stored season.
- `DELETE /schedule/teams/:teamId/seasons/:seasonId`. Requires `manage_events`. `404` when the season is missing. Deleting a season does not delete events.
- `GET /schedule/teams/:teamId/seasons/:seasonId/export?format=ics|csv`

`invalid_season` when the dates are not real calendar dates, the end is before the start, or the span is longer than 366 days.

The export expands events with the same occurrence rules as the schedule list, skips cancelled dates, and includes one row per occurrence: title, event type, start, end, location, and notes. `ics` is a `text/calendar` file. `csv` is `text/csv` with a header row. Both use the team time zone for the displayed times. A season with no occurrences still returns a valid empty calendar or a header-only spreadsheet.

## Screens

On the team page in [client/expo/app/(main)/teams/[teamId].tsx](<client/expo/app/(main)/teams/[teamId].tsx>), members who can `manage_events` can add a season and delete one. The list shows the name and the two dates.

On the schedule in [client/expo/app/(main)/schedule/index.tsx](<client/expo/app/(main)/schedule/index.tsx>), any member can pick a season and download the export. On web, that is a file download. On native, share the file. Strings go in [client/expo/src/en.json](client/expo/src/en.json) and [client/expo/src/es.json](client/expo/src/es.json).

Handler tests: empty list, create and delete round-trip, `invalid_season` for an end before the start, an ICS export that contains one occurrence and omits a cancelled date, and a CSV export with the header and that same occurrence.

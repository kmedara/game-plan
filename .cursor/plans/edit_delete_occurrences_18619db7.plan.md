---
name: Edit delete occurrences
overview: Managers can edit or delete a scheduled event. For a repeating series, the app asks whether the change applies to that date only or to every occurrence.
todos:
  - id: schema-store
    content: Add exdates and exception fields, expansion skips, delete and single-occurrence routes
    status: pending
  - id: client
    content: Schedule row edit/delete with this-occurrence vs all-occurrences prompt
    status: pending
  - id: tests
    content: Store and handler tests for cancel, exception edit, series edit, and series delete
    status: pending
isProject: false
---

# Edit and delete events and occurrences

Occurrences are not stored today. [`listOccurrences`](functions/schedule/src/schedule-store.ts) expands each `EVT#` row with `rrule`. Series edits already exist as `PATCH /schedule/teams/:teamId/events/:eventId`. There is no delete route, and the schedule screen only creates events.

## Series vs one date

A one-off event edits or deletes immediately. A repeating event, or a date that was already split off a series, asks: **this occurrence** or **all occurrences**. No “this and following” option.

- **All** updates or deletes the series row (`seriesEventId`, or `eventId` when the row is the series itself).
- **This date** records an exception and leaves the rest of the series alone.

Storage on the series row in [`EventItem`](functions/schedule/src/schedule-store.ts):

- `exdates: string[]` — UTC start instants that no longer occur (cancelled dates).

A split-off date is a normal one-off `EVT#` row plus:

- `seriesEventId` — the series it came from
- `originalStartsAt` — the series instant it replaced

Expansion skips a series instant when it is in `exdates` or matches an exception’s `originalStartsAt`, then includes exception rows as their own occurrences. RSVPs stay keyed by the occurrence start they were saved against; a moved or deleted date does not rewrite old RSVPs.

## API

Same `manage_events` permission as create and update.

- `DELETE /schedule/teams/:teamId/events/:eventId` — delete the series row and every exception with that `seriesEventId`.
- `DELETE /schedule/teams/:teamId/events/:eventId/occurrences` with `{ occurrenceStartsAt }` — append that instant to `exdates`. If an exception exists for it, delete that row too. `occurrenceStartsAt` is the **original** series instant.
- `POST` the same occurrences path with an update body — create the one-off exception (copy of the series fields, then the patch), set `seriesEventId` and `originalStartsAt`, and add the original instant to `exdates`. If that date is already an exception, `PATCH` the exception row instead.
- Existing `PATCH` on the event remains “change the series.” It does not rewrite existing exceptions.

Add `recurring`, optional `seriesEventId`, and optional `originalStartsAt` to [`scheduleOccurrenceSchema`](lib/schemas/src/schedule.ts) so the client can prompt and target the right row without another fetch. Wire the routes in [`functions/schedule/src/handler.ts`](functions/schedule/src/handler.ts) and the Expo client in [`client/expo/src/api.ts`](client/expo/src/api.ts).

## Schedule screen

On [`client/expo/app/(main)/schedule/index.tsx`](<client/expo/app/(main)/schedule/index.tsx>), managers get Edit and Delete on each event row.

- Edit reuses the add-event sheet, filled from that occurrence (title, type, time, place, repeat). Saving a series asks this date vs all, then calls the exception route or `PATCH`.
- Delete asks the same question when `recurring` is true, otherwise deletes the event.
- Use a small choice sheet (works on web and native) with Cancel, This occurrence, and All occurrences. Copy goes in [`en.json`](client/expo/src/en.json) and [`es.json`](client/expo/src/es.json).

Cover store expansion and the new routes in the schedule tests: cancel one date, edit one date, edit the series, delete the series (exceptions go with it).

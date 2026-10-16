---
name: Reminders and moves
overview: Send push reminders before events people are attending, and a clear push when a game or practice changes time or place, using the fan-out path that already delivers chat and schedule updates.
todos:
  - id: event-moved
    content: Enqueue event_moved on time or location changes and push it to the roster
    status: completed
  - id: reminders
    content: Materialize evening and hour-before reminder rows and sweep them to going and maybe RSVPs
    status: completed
  - id: wire-tests
    content: Schedule the sweep in CDK and local dev, reload the client, and cover the new jobs in tests
    status: completed
isProject: false
---

# Reminders and time or place changes

Push already exists. [`functions/fanout/src/deliver.ts`](functions/fanout/src/deliver.ts) sends “Schedule updated” with the raw event id to the whole roster whenever [`functions/schedule/src/schedule-store.ts`](functions/schedule/src/schedule-store.ts) enqueues `schedule_changed`. That job stays as the live refresh signal (the schedule screen already reloads on it). New pushes carry a real sentence and a narrower audience.

## Time or place changes

On update, occurrence save, and cancel in the schedule store, compare the previous start, end, location, and coordinates with the next values.

- If any of those changed, enqueue `event_moved` in [`lib/schemas/src/fanout.ts`](lib/schemas/src/fanout.ts): `teamId`, `eventId`, `title`, `occurrenceStartsAt` when one date changed, and `change` of `time`, `location`, or `both`.
- Title-only, notes-only, and brand-new events do not send this push. Creating an event still enqueues `schedule_changed` for the open app.
- Fan-out delivers `event_moved` to every current team member, and sends the push even when a WebSocket is open (same as join requests). Copy is the event title plus “time changed”, “location changed”, or both. `schedule_changed` no longer sends a push.

## Reminders

Two reminders per occurrence, only for people whose RSVP is `going` or `maybe`:

- The evening before, at 18:00 in the team time zone.
- One hour before the start.

Writing an event materializes those instants for occurrences in the next eight weeks onto a `REMINDERS` partition, sort key `REMINDER#<dueAt>#<eventId>#<occurrenceStartsAt>#<evening|hour>`. Updates and deletes replace or remove that event’s future rows. A due row in the past at write time is not created.

A sweep in `functions/schedule/src/reminders.ts` queries due rows, loads RSVPs, enqueues `event_reminder` (title, when, location) for those users, then deletes the row. [`infrastructure/lib/api.ts`](infrastructure/lib/api.ts) adds an EventBridge rule every 15 minutes on the schedule function. The handler accepts that event as well as API Gateway. Locally, [`local/src/dev.ts`](local/src/dev.ts) calls the same sweep once a minute. Push copy matches the other fan-out titles (English). The open app treats `event_moved` and `event_reminder` like `schedule_changed` and reloads.

## Tests

Unit-test due-time selection (evening in the team zone, hour-before, skip past times, eight-week cap). Handler or store tests assert `event_moved` only when start or location changes, and that a reminder job includes only `going` and `maybe` user ids. Extend the fan-out delivery test so `schedule_changed` does not push and `event_moved` does.

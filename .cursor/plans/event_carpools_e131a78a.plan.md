---
name: Event carpools
overview: Let a teammate offer a number of seats on one event date, and let others claim those seats, shown on the event sheet next to attendance.
todos:
  - id: api
    content: Add carpool schemas, Dynamo key, and offer and claim routes
    status: completed
  - id: ui
    content: Show offers, seat counts, and claim controls on the event sheet
    status: completed
  - id: tests
    content: Cover offer, claim, full car, and switching cars in handler tests, plus English and Spanish strings
    status: completed
isProject: false
---

# Event carpools

Any event date can have rides. A member offers seats. Other members claim one seat each. The location pin already on the event is what the ride is for. No new permission: every team member can offer or claim.

## Stored row

One item on the team partition, `CARPOOL#<occurrenceStartsAt>#<eventId>`, same occurrence identity as a lineup. The item holds `offers`:

- `userId` of the driver, at most once
- `seats`: integer from 1 to 8
- `riderIds`: members who claimed a seat, each person on at most one offer, never the driver, and never more riders than seats

Schemas live in [lib/schemas/src/schedule.ts](lib/schemas/src/schedule.ts) and the OpenAPI map. Regenerate [lib/types/src/generated/schema-types.ts](lib/types/src/generated/schema-types.ts). The key helper sits next to `lineupSk` in [functions/lib/dynamo/keys.ts](functions/lib/dynamo/keys.ts).

## Routes

Both require team membership. A missing row is an empty list.

- `GET /schedule/teams/:teamId/carpool?eventId&occurrenceStartsAt`
- `PUT` the same path with `{ eventId, occurrenceStartsAt, seats }`. `seats` from 1 to 8 creates or replaces the caller's offer and keeps existing riders that still fit. `seats: 0` removes the offer. Riders who no longer fit are dropped.
- `PUT /schedule/teams/:teamId/carpool/claim` with `{ eventId, occurrenceStartsAt, driverUserId }`. Claiming adds the caller to that offer when a seat is free and removes them from any other offer on this date. Claiming the same driver again removes the caller (a toggle). The driver cannot claim their own car.

`occurrence_not_found` when that instant is not a real date of the event. A driver or rider who is not a current member is rejected.

## Sheet

On the event sheet in [client/expo/app/(main)/schedule/index.tsx](<client/expo/app/(main)/schedule/index.tsx>), under attendance, show each offer as the driver's name, seats taken and seats offered, and the rider names. The signed-in member can set how many seats they are offering, clear the offer, and claim or leave a ride. Strings go in [client/expo/src/en.json](client/expo/src/en.json) and [client/expo/src/es.json](client/expo/src/es.json).

Handler tests: empty get, offer and claim round-trip, claim rejected when the car is full, a driver cannot claim their own seats, and a second claim moves the rider off the first car.

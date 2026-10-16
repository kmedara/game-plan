---
name: Multiple team roles
overview: A team member can hold more than one of the existing roles (team admin, coach, player, parent). Permissions and roster checks use the full set. Invites still add someone as exactly one role.
todos:
  - id: schema-rules
    content: Add roles on membership schemas and union/rank helpers, with read fallback from role
    status: completed
  - id: store-checks
    content: Write roles on both membership rows and use the set in permission, grant, minor, and fan-out checks
    status: completed
  - id: assign-api
    content: Change role assignment to replace the set and cover it with tests
    status: completed
  - id: client
    content: Show every role, and let someone with assign_roles edit the set on the member profile
    status: completed
isProject: false
---

# Multiple roles on one member

A person on a team holds a non-empty set of `team_admin`, `coach`, `player`, and `parent`. A parent who also coaches is both. Playing positions stay a separate list.

Invites and join approval stay one role. That role is the set they join with. Someone who can assign roles edits the set afterward.

## Rules

- Effective permissions are the union of every role in the set. [`can`](functions/lib/permissions.ts) and join-request fan-out in [`deliver.ts`](functions/fanout/src/deliver.ts) grant an action when any held role grants it.
- Rank uses the highest role. [`TEAM_ROLES`](lib/schemas/src/enums.ts) stays ordered admin, coach, player, parent. A caller may change a member only when they can grant every role already on that member and every role in the new set (same rule as today’s single-role assign in [`members.ts`](functions/teams/src/routes/members.ts)).
- The new set cannot be empty. Each role is checked with the existing minor rules: no `team_admin`, and no role whose permissions include `manage_permissions`.
- Existing rows that only have `role` are read as a one-role set. Writes store `roles` and keep `role` as the highest-ranked role so older rows and any unread path still have a string. `roles` is what checks use.

## API

- Membership responses gain `roles`. [`teamMemberSchema`](lib/schemas/src/teams.ts), the member profile, and [`teamSummarySchema`](lib/schemas/src/teams.ts) (the caller’s own membership) include it. `role` remains the highest role.
- `PATCH /teams/:teamId/members/:userId` body becomes `{ roles: TeamRole[] }` (at least one, no duplicates). [`assignMemberRole`](functions/teams/src/team-store.ts) writes both the roster row and the user-side membership, and preserves positions.
- Invite create, accept, and join approval still take one role and store it as `roles: [role]`.

## App

- [`RolePicker`](client/expo/src/role-picker.tsx) stays single-choice for invites and join approval.
- The member profile ([`members/[userId].tsx`](<client/expo/app/(main)/teams/[teamId]/members/[userId].tsx>)) shows every role. When the viewer has `assign_roles`, the same pills toggle, and save calls the patch. The viewer’s grantable roles come from their highest role.
- The roster ([`team-roster.tsx`](client/expo/src/team-roster.tsx)) lists every role.
- “Players who have not RSVP’d” in [`schedule/index.tsx`](<client/expo/app/(main)/schedule/index.tsx>) includes anyone whose set contains `player`. Guardian visibility treats the viewer as a coach or admin when either role is in their set.
- The permission screen’s minor check matches a member when the role is in their set.

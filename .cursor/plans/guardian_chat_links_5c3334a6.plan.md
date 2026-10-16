---
name: Guardian chat links
overview: Link an adult guardian to a minor, require that guardian on any private chat between the minor and a non-guardian adult, and stop showing the minor’s phone number to the rest of the team.
todos:
  - id: links
    content: Store guardian links and invite, accept, and remove routes
    status: completed
  - id: chat
    content: Require a linked guardian on adult-minor chats and add them when a chat is created
    status: completed
  - id: phone
    content: Hide a minor's phone number from everyone except the minor and their guardians
    status: completed
isProject: false
---

# Guardian links

This follows the SafeSport electronic-communications rule: an adult does not message or call a minor alone. A parent is linked to that minor and is included. Minor-to-minor chat on a shared team stays allowed. Hiding a minor’s phone from other minors only is not part of this.

## Link

A minor invites a guardian. The guardian must be an adult account. Accepting stores the pair on both users: `USER#<minorId>` / `GUARDIAN#<adultId>` and `USER#<adultId>` / `CHILD#<minorId>`. A minor may have more than one guardian. Either person, or a team admin of a team they share, can remove the link.

Routes on the identity or teams area:

- `POST /identity/guardians` with the other person’s email creates a pending invite.
- `POST /identity/guardians/:inviteId/accept` confirms it when the caller is the adult.
- `DELETE /identity/guardians/:userId` removes the link.

The minor’s member profile, [lib/schemas/src/teams.ts](lib/schemas/src/teams.ts), gains `guardianIds` for coaches and the linked adults. Other members do not receive that list.

## Chat

Extend [lib/rules/src/index.ts](lib/rules/src/index.ts) next to `isMinorChatMembershipAllowed`. A chat that includes a minor and an adult who is not that minor’s guardian must also include at least one of that minor’s guardians. Team channels already contain the roster; creating one adds any missing linked guardians of minors on that team. Creating a private chat in [functions/chat/src/routes/create.ts](functions/chat/src/routes/create.ts) does the same before the membership check. If the minor has no guardian yet, a private chat with a non-guardian adult is rejected with `guardian_required`.

## Phone

`GET /teams/:teamId/members/:userId` omits `phoneNumber` when the profile is a minor and the caller is not that minor or a linked guardian. The schedule sheet already hides call and text when there is no number, so coaches reach the family through a chat that includes the guardian. The guardian’s own number stays visible to teammates.

## Tests

Rule tests: adult plus minor without a guardian fails; the same set plus a guardian passes; two minors on one team still pass. Route tests: private-chat create adds the guardian, and a minor profile hides the phone from a teammate who is not the guardian.

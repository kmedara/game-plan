---
name: Team page layout shift
overview: Stop the team page from painting the roster before settings and the chat background are ready, reserve the background photo’s height, and put the logo on the same row as the color wells.
todos:
  - id: gate-ready
    content: Render team settings and roster only after ready
    status: completed
  - id: reserve-background
    content: Reserve the chat background frame and overlay row when a key exists
    status: completed
  - id: logo-row
    content: Place the team logo and color wells on one row
    status: completed
isProject: false
---

# Team page layout shift

The roster heading in [`client/expo/app/(main)/teams/[teamId].tsx`](<client/expo/app/(main)/teams/[teamId].tsx>) renders immediately. Member cards are inserted after `listMembers`, then the settings form (including the chat background) is inserted above the roster once `canManageSettings` is known. That is the 0.1063 shift. The background image URL arrives later, so [`client/expo/src/team-chat-background.tsx`](client/expo/src/team-chat-background.tsx) swaps the short “Add background” line for a 112px photo plus the overlay row. That is the 0.0318 shift.

## Changes

- Keep the team screen on a single placeholder until `ready` is true. `load` already sets members, permissions, and `canManageSettings` before `setReady(true)`, so the settings block and the roster appear in one paint. The placeholder is only the existing scroll container, with no roster heading underneath it.
- In `TeamChatBackground`, when `theme.chatBackgroundKey` is set, render the `h-28` frame and the Dark / Light / None row immediately. Put the image in that frame when `uri` arrives. Show “Add background” only when there is no key.
- In [`client/expo/app/(main)/teams/[teamId].tsx`](<client/expo/app/(main)/teams/[teamId].tsx>), put `TeamLogo` and `TeamColors` in one `flex-row` with `items-start`. The logo stays a centered column (photo, “Team logo”, trash), matching a color well, and sits on the same line as Primary, Secondary, and Accent. Drop the logo block’s extra bottom margin so the row spacing matches the color wells.

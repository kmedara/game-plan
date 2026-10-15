---
name: Button hierarchy
overview: Give GamePlan a sharp athletic palette (cool white, charcoal, turf green) and a single strong primary button with quieter secondary actions.
todos:
  - id: tokens
    content: Replace the warm tan surfaces with cool white, charcoal, and a sharp turf green
    status: completed
  - id: button
    content: Add primary, secondary, and danger button tones with a pressed state
    status: completed
  - id: hierarchy
    content: Mark the second action on teams, chats, and profile as secondary
    status: completed
isProject: false
---

# Sharper athletic brand and stronger buttons

[Mobbin’s button gallery](https://mobbin.com/explore/mobile/ui-elements/button) shows one filled action per group: tall, full width, solid color, white label, and a pressed state. Secondary actions are outline or text. GamePlan’s [`Button`](client/expo/src/ui.tsx) is a short filled block with a drop shadow, and every action uses that same fill. The current surfaces are warm tan, which reads soft rather than athletic.

## Color

Replace the tan scale in [`client/expo/src/theme.ts`](client/expo/src/theme.ts) and [`client/expo/tailwind.config.js`](client/expo/tailwind.config.js) with a cool, high-contrast set. Keep the four surface steps:

- canvas `#eef2ef`, raised `#f7f9f8`, paper `#ffffff`, inset `#e4ebe6`, line `#c5d0c9`
- ink `#101412`, muted `#5c675f`
- field `#0c7a43` (turf), field-deep `#08562f` (pressed)
- danger `#c42318`

Also point the hardcoded date-input colors in [`birthday-field.tsx`](client/expo/src/birthday-field.tsx) and [`day-field.tsx`](client/expo/src/day-field.tsx) at these values, plus the notification color in [`client/expo/app.json`](client/expo/app.json) and the team color placeholder. Team `theme.primary` still tints only the header.

## Buttons

In [`client/expo/src/ui.tsx`](client/expo/src/ui.tsx), replace the single filled style:

- `primary`: full width, min height 52, `rounded-2xl`, field fill, white semibold label, no shadow. Pressed background is `fieldDeep`. Disabled uses 40% opacity on the same fill.
- `secondary`: same size, paper fill, field border and label.
- `danger`: same size, danger fill, white label (sign out).

`SubmitButton` passes `tone` through. The existing `color` prop stays for a team-colored primary when a caller passes it.

## Where the second action drops to secondary

- Teams: Join stays primary, Create team becomes secondary ([`teams/index.tsx`](<client/expo/app/(main)/teams/index.tsx>)).
- Chats: start a private chat stays primary, new channel becomes secondary ([`chats/index.tsx`](<client/expo/app/(main)/chats/index.tsx>)).
- Profile: save phone stays primary, add photo becomes secondary, sign out stays danger ([`profile.tsx`](<client/expo/app/(main)/profile.tsx>)).

Login, save, send, add event, and invite stay primary. No new screens.

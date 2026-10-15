---
name: Warm field theme
overview: Introduce a cream-and-field-green token set and apply it across every Expo screen, shared control, sheet, and chat bubble, while team colors still tint the signed-in header.
todos:
  - id: tokens
    content: Add NativeWind colors and shared hex constants; point brand fallback and app.json at field green
    status: completed
  - id: controls
    content: Restyle shared controls, sheets, and pickers with the token classes
    status: completed
  - id: screens
    content: Apply canvas, paper cards, and field accents across every Expo screen including chat bubbles
    status: completed
isProject: false
---

# Warm field branding

GamePlan today is slate surfaces plus a hardcoded teal (`#0f766e`) in [`client/expo/src/theme.ts`](client/expo/src/theme.ts), [`client/expo/src/ui.tsx`](client/expo/src/ui.tsx), the tab bar, and chat bubbles. [`client/expo/tailwind.config.js`](client/expo/tailwind.config.js) has no custom colors. Team `theme.primary` already overrides the header via `brandColors` in [`client/expo/src/state.tsx`](client/expo/src/state.tsx); that stays.

## Tokens

Extend NativeWind in [`client/expo/tailwind.config.js`](client/expo/tailwind.config.js):

- `canvas` `#f4efe4` page background
- `paper` `#fffdf8` cards, inputs, sheets
- `line` `#e6dccb` borders
- `ink` `#1f1a14` primary text
- `muted` `#6f6558` secondary text
- `field` `#3d6b4f` brand green (buttons, selected tabs, own chat bubbles when no team color)
- `field-deep` `#2c4f3a` pressed / emphasis
- `danger` `#9b3a32` errors

Export the same hex values from [`client/expo/src/theme.ts`](client/expo/src/theme.ts) so style props (buttons, header fallback, notification tint) match the classes. Change the brand fallback and the button default from `#0f766e` to `field`. Update the color placeholder in [`client/expo/app/(main)/teams/[teamId].tsx`](<client/expo/app/(main)/teams/[teamId].tsx>) and the notification color in [`client/expo/app.json`](client/expo/app.json).

## Shared controls

In [`client/expo/src/ui.tsx`](client/expo/src/ui.tsx) and [`client/expo/src/sheet.tsx`](client/expo/src/sheet.tsx): cream canvas, paper fields with `line` borders, ink/muted labels, field-green primary buttons, rounded-xl cards. Selected states in [`role-picker.tsx`](client/expo/src/role-picker.tsx), [`recurrence-fields.tsx`](client/expo/src/recurrence-fields.tsx), [`event-time.tsx`](client/expo/src/event-time.tsx), birthday and day fields, and map picker swap `teal-*` / `slate-*` for the tokens.

## Screens

- Shell in [`client/expo/app/(main)/_layout.tsx`](<client/expo/app/(main)/_layout.tsx>): canvas body, paper tab bar, selected tab in `field` (team color stays on the header only).
- Login and complete-profile: wordmark “GamePlan”, tagline, paper card on canvas.
- Schedule, chats, teams, profile, invite, member, and chat thread: list rows become paper cards with a light shadow and consistent padding. Own messages use `brand.primary` (fallback `field`) with `onPrimary` text.
- Root layout background matches `canvas`.

No new screens or copy beyond the login wordmark. No dark mode.

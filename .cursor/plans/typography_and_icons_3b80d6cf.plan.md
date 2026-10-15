---
name: Typography and icons
overview: Load Inter as the app typeface and add Lucide SVG icons, then replace the text glyphs used for navigation, calendar, and close actions.
todos:
  - id: fonts
    content: Load Inter weights and map NativeWind font classes to the font files
    status: completed
  - id: icons
    content: Add lucide-react-native and replace glyph controls plus tab icons
    status: completed
isProject: false
---

# Typography and icons

The Expo app currently uses the platform default font and a few text stand-ins (`❮`, `<`, `>`, `×`) for controls. Tabs in [`client/expo/app/(main)/_layout.tsx`](<client/expo/app/(main)/_layout.tsx>) are labels only.

## Type

Use **Inter** (SIL Open Font License) via `@expo-google-fonts/inter` and `expo-font`. Load Regular (400), Medium (500), SemiBold (600), and Bold (700) in [`client/expo/app/_layout.tsx`](client/expo/app/_layout.tsx) and hold the tree until the fonts are ready.

React Native does not pick a custom-font file from `fontWeight` alone, so map the existing NativeWind classes in [`client/expo/tailwind.config.js`](client/expo/tailwind.config.js) to the matching files (`font-sans` → 400, `font-medium` → 500, `font-semibold` → 600, `font-bold` → 700). Screens already use `font-semibold` and `font-bold`, so body copy and headings pick up Inter without a sweep of every `Text`.

## Icons

Use **Lucide** (`lucide-react-native` + `react-native-svg`). Icons are SVG, so they stay sharp at any size, and the set is free (ISC).

Replace the glyph controls with 24px stroke icons, colored with the existing brand and ink tokens:

- Header back in [`client/expo/app/(main)/_layout.tsx`](<client/expo/app/(main)/_layout.tsx>) — `ChevronLeft`
- Month pager in [`client/expo/app/(main)/schedule/index.tsx`](<client/expo/app/(main)/schedule/index.tsx>) — `ChevronLeft` / `ChevronRight`
- Close on the chat composer in [`client/expo/app/(main)/chats/[chatId].tsx`](<client/expo/app/(main)/chats/[chatId].tsx>) — `X`
- Bottom tabs — `Calendar`, `MessageCircle`, `Users`, `User`, with the label kept under the icon. Active tab uses `brand.accent`; inactive uses `colors.muted`.

No other screens get new decorative icons in this pass.

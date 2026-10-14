# Maps for event locations

Event locations support place autocomplete when creating an event, an interactive
map above the location field, and **Open in Maps** links on the schedule day list.

**Places** and **Geocoding** calls go through the **`places` API area** with the
server key. Map **tiles / SDKs** use separate browser and Android keys on the
client. Keys are never shared across roles.

## Providers

| Concern | Provider |
| ------- | -------- |
| Autocomplete / resolve | Google Places API (New), proxied by `GET /places/…` |
| Map pin reverse geocode | Google Geocoding API, proxied by `GET /places/reverse` |
| Interactive map (web) | Maps JavaScript API (`GOOGLE_MAPS_BROWSER_API_KEY`) |
| Interactive map (Android) | Maps SDK for Android (`GOOGLE_MAPS_ANDROID_API_KEY`) |
| Interactive map (iOS) | MapKit (no Google client key) |
| Open in Maps (device) | Apple Maps on iOS; Google Maps on Android/web |

## Three API keys

| Role | Env var | Restrictions |
| ---- | ------- | ------------ |
| Server | `GOOGLE_MAPS_API_KEY` | Places API (New), Geocoding API; IP / none for local |
| Browser | `GOOGLE_MAPS_BROWSER_API_KEY` | Maps JavaScript API only; HTTP referrers |
| Android | `GOOGLE_MAPS_ANDROID_API_KEY` | Maps SDK for Android; package `com.gameplan.app` + SHA-1 |

## Google Cloud setup

1. Open the Google Cloud Console and create or select a project.
2. Enable **Places API (New)**, **Geocoding API**, **Maps JavaScript API**, and
   **Maps SDK for Android**.
3. Create **three** API keys with the restrictions in the table above.

## Server environment

Set `GOOGLE_MAPS_API_KEY` on the **API** process only.

**Compose:** put the key in a `.env` file next to [`docker-compose.yml`](../../docker-compose.yml):

```bash
GOOGLE_MAPS_API_KEY=server-key-here
```

The `api` service passes it through. Recreate the API container after changing it.

**Local `npm run dev`:** export the same variable so `local/src/dev.ts` injects it
into the `places` area process.

When the server key is missing, place routes return `503 places_not_configured`.
Free-text event locations still work without autocomplete.

## Browser environment

Set `GOOGLE_MAPS_BROWSER_API_KEY` when starting or building the Expo app.
[`run.mjs`](../../client/expo/scripts/run.mjs) copies that value onto
`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, which the web bundle reads at build time.

```bash
GOOGLE_MAPS_BROWSER_API_KEY=browser-key-here npm run client:start
```

If the browser key is missing, the web map shows an unavailable state (no OSM
fallback).

## Android environment

Put the Android key in the Expo app config (`android.config.googleMaps.apiKey` in
[`app.json`](../../client/expo/app.json)). Expo prebuild writes it into
`AndroidManifest.xml` as `com.google.android.geo.API_KEY`. The JavaScript bundle
does not include this key; `react-native-maps` reads it from the manifest.

Package name for key restriction: **`com.gameplan.app`**. Add the debug and
release SHA-1 fingerprints from the signing certificate.

## API routes

All require a signed-in caller:

| Method | Path | Result |
| ------ | ---- | ------ |
| `GET` | `/places/autocomplete?q=` | Suggestion list |
| `GET` | `/places/resolve?id=` | Label + latitude + longitude |
| `GET` | `/places/reverse?latitude=&longitude=` | Label for a map pin |
| `GET` | `/places/map?latitude=&longitude=` | PNG map image (optional) |

## Map picker

The add-event form shows an interactive map above the location field. Users can
search with autocomplete or set a pin on the map. Pin changes call
`GET /places/reverse` so the address label stays in sync. After a selection, the
location input shows the **full** resolved label (name and formatted address).

## Stored fields

Events keep `location` as the display label. Optional `latitude` and `longitude`
are stored when the user picks a suggestion or drops a map pin. Free-text
locations omit coordinates; map links then use the label as the query.

# Maps for event locations

Event locations support place autocomplete when creating an event, an interactive
map above the location field, and **Open in Maps** links on the schedule day list.

**Places**, **Geocoding**, and **Static Maps** calls go through the **`places`
API area** with the server key. Map **tiles / SDKs** use separate browser and Android keys on the
client. Keys are never shared across roles.

## Providers

| Concern | Provider |
| ------- | -------- |
| Autocomplete / resolve | Google Places API (New), proxied by `GET /places/…` |
| Map pin reverse geocode | Google Geocoding API, proxied by `GET /places/reverse` |
| Map preview image | Maps Static API, proxied by `GET /places/map` |
| Interactive map (web) | Maps JavaScript API (`GOOGLE_MAPS_BROWSER_API_KEY`) |
| Interactive map (Android) | Maps SDK for Android (`GOOGLE_MAPS_ANDROID_API_KEY`) |
| Interactive map (iOS) | MapKit (no Google client key) |
| Open in Maps (device) | Apple Maps on iOS; Google Maps on Android/web |

## Three API keys

| Role | Env var | Restrictions |
| ---- | ------- | ------------ |
| Server | `GOOGLE_MAPS_API_KEY` | Places API (New), Geocoding API, Maps Static API; no application restriction (Lambda has no fixed IP) |
| Browser | `GOOGLE_MAPS_BROWSER_API_KEY` | Maps JavaScript API only; HTTP referrers for every origin you open, see below |
| Android | `GOOGLE_MAPS_ANDROID_API_KEY` | Maps SDK for Android; package `com.gameplan.app` + SHA-1 |

## Google Cloud setup

1. Open the Google Cloud Console and create or select a project.
2. Turn on billing for the project; Google refuses every Maps API without it.
3. Enable **Places API (New)**, **Geocoding API**, **Maps Static API**,
   **Maps JavaScript API**, and **Maps SDK for Android**.
4. Create **three** API keys with the restrictions in the table above.

Without **Maps Static API** on the server key, search still works but
`GET /places/map` fails, so map preview images do not load.

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

If the browser key is missing, or Google rejects it, the web map shows an
unavailable state (no OSM fallback).

### Browser key referrers

The browser key only works on the websites its referrer list names, so list
every origin people open the site from:

- `https://<site host>/*` for each deployed stage
- `http://localhost:4200/*` for local work
- `http://<laptop LAN IP>:4200/*` when a phone on the same Wi-Fi opens the dev server

A map that works on the laptop but not on a phone is almost always a missing
origin. On Android, open `chrome://inspect` on the computer with the phone
connected over USB and read the console: `RefererNotAllowedMapError` means a
missing origin, `ApiNotActivatedMapError` means Maps JavaScript API is not
enabled on the key, and `InvalidKeyMapError` means the website was built
without the key or with the wrong one.

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

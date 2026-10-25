# Store release

How the iOS and Android apps are built, linked to the website, listed, and sent to review. The apps and the website are the same Expo tree in [`client/expo`](../client/expo).

## What is in the repo

| File | What it does |
| --- | --- |
| [`client/expo/app.json`](../client/expo/app.json) | Name, bundle id `com.gameplan.app`, icons, splash, photo-library text, the `gameplan` scheme. |
| [`client/expo/app.config.ts`](../client/expo/app.config.ts) | Adds the per-environment parts: invite app links for the website host, and the Android Google Maps key. |
| [`client/expo/eas.json`](../client/expo/eas.json) | `preview` (internal install, staging) and `production` (store) builds. Build numbers are kept by EAS and go up on each production build. |
| [`client/expo/scripts/app-links.js`](../client/expo/scripts/app-links.js) | The link host, the iOS association file, and the Android asset links. Only `/invite/*` opens the app. |

The custom-scheme links `gameplan://auth`, `gameplan://billing`, and `gameplan://payments` already return the app from sign-in and Stripe, and Expo Router opens them from a cold start.

## One-time setup

1. **Accounts.** An Apple Developer Program membership and a Google Play Console account. Create the app in App Store Connect (bundle id `com.gameplan.app`) and in Play Console (package `com.gameplan.app`).
2. **EAS environment variables.** Terraform sets these for the `preview` (staging) and `production` environments of project `gameplan` (see [`infrastructure/terraform`](../infrastructure/terraform/README.md)); do not edit them on expo.dev. Change the Parameter Store source instead; the next deploy copies it:

   | Variable | Value | Visibility |
   | --- | --- | --- |
   | `EXPO_PUBLIC_API_BASE_URL` | `https://<environment>.<domain>/api` | Plain text |
   | `EXPO_PUBLIC_WS_BASE_URL` | `wss://<environment>.<domain>/api/socket` | Plain text |
   | `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser Maps key (used by the web map only), from `<prefix>/google-maps-browser-api-key` | Plain text |
   | `GOOGLE_MAPS_ANDROID_API_KEY` | Maps SDK for Android key, restricted to the package and signing certificate, from `<prefix>/google-maps-android-api-key` | Sensitive |
   | `EXPO_PUBLIC_IOS_WEB_UPGRADE` | `<prefix>/ios-web-upgrade`; unset means `false`, which the first submission needs (see [Payments](#payments-and-review)) | Plain text |
   | `EXPO_PUBLIC_SUPPORT_EMAIL` | The address on the privacy page, from `<prefix>/support-email`. The website build reads the same parameter. Unset leaves the contact line off the page. | Plain text |

   The link host comes from `EXPO_PUBLIC_API_BASE_URL`, so there is no separate host setting. `npm run client:start` and the website build do not read these.

   The Maps keys come from [`infrastructure/terraform-google`](../infrastructure/terraform-google/README.md). After the first build, add the **SHA-1** of the Play app signing and upload keys to its `android_cert_sha1`, apply it, and deploy; until then the Android build has no map.
3. **Signing.** Run the first build from `client/expo` and let EAS create and keep the credentials:

   ```sh
   npx eas-cli build --profile production --platform all
   ```

   Turn on Play App Signing when Play Console asks.
4. **App links on the website.** In each GitHub environment, add two **variables** (not secrets):

   | Variable | Where to find it |
   | --- | --- |
   | `APPLE_TEAM_ID` | Apple Developer → Membership details → Team ID |
   | `ANDROID_CERT_SHA256` | Play Console → App integrity → App signing: the **app signing** key's SHA-256, then a comma and the **upload** key's SHA-256 (`npx eas-cli credentials` prints it) |

   The next deploy writes `/.well-known/apple-app-site-association` (served as JSON) and `/.well-known/assetlinks.json`. Until both are set, invite links open the website, which still works.
5. **Push.** `npx eas-cli credentials` → iOS → set up a push key. For Android, add the FCM V1 service account key there too. Remote push does not work in a build until this is done.
6. **Apple and Google sign-in.** Put the provider credentials in Parameter Store under the deploy prefix (`/gameplan` by default). The deploy loads them as environment variables, and the user pool adds a provider only when all of its values are present:

   | Parameter | Value |
   | --- | --- |
   | `google-client-id`, `google-client-secret` | A Google Cloud OAuth client of type *Web application*, with the authorized redirect URI `https://<cognito-domain>/oauth2/idpresponse` |
   | `apple-client-id` | An Apple *Services ID* (not the bundle id), with return URL `https://<cognito-domain>/oauth2/idpresponse` |
   | `apple-team-id` | The Apple developer Team ID |
   | `apple-key-id`, `apple-private-key` | A Sign in with Apple key and its `.p8` contents. Use a String parameter: the loader reads with decryption off, so a SecureString would arrive still encrypted. |

   Create the Google client and its consent screen in the Cloud Console, and set the consent screen to *In production*; Google has no API for either, so Terraform cannot. `<cognito-domain>` is the `HostedUiDomain` stack output. The login screen asks `GET /api/identity/oauth/providers` and shows a button for each provider the pool has, so nothing changes in the app when a provider is added.

## Build and submit

Builds run on Expo's servers. GitHub only starts them:

- **Publishing a GitHub release** deploys production, then builds both apps and submits them (TestFlight, and a draft on the Play internal track).
- **Actions → App builds** starts a build by hand: `staging` uses the `preview` profile, `production` the `production` profile, and **Submit** works for production only. Run **Deploy** for the environment first, so the build gets the current EAS variables.

The run summary links each build. Both workflows use `<prefix>/expo-token`, and the deploy role needs `ssm:GetParameter` on it.

Before a workflow can build or submit without anyone at the keyboard:

1. **First build of each platform by hand**, so EAS creates the Android keystore and, after an Apple sign-in, the iOS certificates.
2. **iOS submit:** add an App Store Connect API key with `npx eas-cli credentials` → iOS, and set `ascAppId` (App Store Connect → the app → App Information → Apple ID) under `submit.production.ios` in `client/expo/eas.json`.
3. **Android submit:** upload the first app bundle in Play Console yourself (Google's API cannot create an app's first release), then add a Google service account key with Play access with `npx eas-cli credentials` → Android.
4. **iOS preview builds** are ad hoc: a phone added with `npx eas-cli device:create` gets the app only after the next build.

By hand, from `client/expo`:

```sh
# Install on test phones (staging API)
npx eas-cli build --profile preview --platform all

# Store builds, then upload: TestFlight for iOS, a draft on the Play internal track
npx eas-cli build --profile production --platform all
npx eas-cli submit --profile production --platform all --latest
```

`version` in `app.json` is the version people see; raise it for each store release. EAS sets the build number.

## Check before each submission

Run these on a production build on a real phone, with the app closed first each time.

- [ ] Text yourself `https://<host>/invite/<code>` and tap it. The app opens on the invite page. Signed out, it goes to login, and after sign-up the team is joined.
- [ ] Same link with the app uninstalled: the website opens.
- [ ] Continue with Apple, Continue with Google, and Continue with email each sign in, and the browser hands back to the app. On iPhone the Apple button is Apple's own.
- [ ] Profile → Delete account on a throwaway account: it signs out, and signing in again starts a new account. On an account that is a team's only admin with teammates, it names the team instead.
- [ ] Team plan checkout (Android) and the billing portal return to the app on the billing page.
- [ ] Dues payment and team payout setup return to the app on the payments page.
- [ ] Notifications are asked for only after a tap, and an alert arrives while the app is closed.
- [ ] An event map shows on Android (the Maps key is in the build).
- [ ] Pick a team logo and a profile photo.

## Listing copy

Use the same copy on both stores. Spanish matches [`es.json`](../client/expo/src/es.json) when the app is listed in a Spanish storefront.

- **Name:** GamePlan
- **Subtitle (iOS, 30 characters):** Team schedule, chat, and dues
- **Short description (Android, 80 characters):** Practices, games, chat, RSVPs, and dues for every team you are on, in one app.
- **Category:** Sports (secondary: Productivity)
- **Keywords (iOS, 100 characters):** team,schedule,coach,club,youth sports,rsvp,carpool,dues,league,practice,roster,parents

**Description**

> GamePlan keeps a season in one place for players, parents, and the whole coaching staff.
>
> - One calendar for every team you or your child is on, across sports and clubs.
> - RSVP for practices and games, sign up for snacks and carpools, and see who is coming.
> - Team chat, polls, and announcements from your club.
> - Pay team dues on your phone.
> - Keep medical info and emergency contacts with the person, shared only with staff who need it.
> - Coaches build lineups and schedule fixtures with other clubs.
>
> Join with the invite link your coach or club sends. Clubs and teams can upgrade on the GamePlan website.

**Screenshots** (6.9" iPhone, 13" iPad, and a Play phone set): the merged schedule with two teams, an event with RSVP and carpool, team chat, a dues list, the medical form, and a team page.

## Privacy answers

GamePlan does not use analytics, ad, or tracking SDKs, so nothing is "used to track you". Everything below is linked to the person's account and used only to run the app.

| Data | App Store category | Why |
| --- | --- | --- |
| Name, email, phone | Contact info | Account, invites, team roster |
| Birthday | Other user content | Adult or minor rules, guardian links |
| Medical info and emergency contacts | Health | Shown to staff with the medical permission |
| Photos and files | Photos or videos; Other user content | Logos, profile pictures, chat attachments |
| Chat messages and polls | Other user content | Team chat |
| Payment status (cards stay with Stripe) | Purchase history | Team dues and plans |
| Push token | Device ID | Notifications |
| Email address or phone number typed to send an invite | Contact info (of someone else) | GamePlan emails or texts the invite once; the address or number is not stored |

The app never reads the device's location; event addresses are typed by staff. Data Safety on Play: the same list, data encrypted in transit, and people can delete their account in the app (Profile → Delete account).

**What account deletion removes:** the sign-in account, profile and photo, medical info and emergency contacts, settings, devices, calendar feed, the person's dues list, every team and chat membership, guardian links, and organization admin seats. **What stays with the team:** messages they sent (with the name shown at the time), past RSVPs, and the team's own dues ledger. A free team outside any organization with nobody else on it is deleted with its schedule, chats, invite codes, and logo; a game it shared with another club stays on that club's calendar without the link. Someone who owns an organization, or is the only admin of a team that still has members or pays for its own plan, is asked to hand that over first.

## Payments and review

- **Team and club plans** are bought on the website through Stripe. On iOS the build shows "Plans are managed on the GamePlan website" and no price or link while `EXPO_PUBLIC_IOS_WEB_UPGRADE` is `false`. Turn it on (`<prefix>/ios-web-upgrade` = `true`) only for storefronts where Apple allows an external purchase link.
- **Team dues** are payments for real-world activities (fees, uniforms, travel), which both stores allow outside in-app purchase. Say so in the review notes.
- **Review notes:** give a demo adult account on a team with events, chat, and an open due. Note that the app is for organized teams, invite-only by design, and that minors' accounts are managed by their guardians.
- **Age rating:** answer "Yes" to user-generated content (team chat) and "No" to unrestricted web access. Do not choose the Kids category: the app is for teams that include minors, not directed at children.

## Still blocking the first submission

- **Privacy policy review.** The policy is at `https://<host>/privacy` (text in [`client/expo/src/privacy-policy.ts`](../client/expo/src/privacy-policy.ts)), linked from the login and profile screens. Use that URL in both stores and as Play's account-deletion URL: its "Deleting your account" section explains how. Before submitting, set `<prefix>/support-email`, and have someone qualified review the text, the Spanish translation, and how children under 13 sign up (below).
- **Children under 13.** Anyone can create an account with any birthday, and the app only tells adults (18+) from minors. In the US, collecting information from a child under 13 needs verifiable parental consent (COPPA). Decide between an age gate that sends under-13s to a guardian-created account, or a consent flow, before launch; the policy says only that GamePlan is not directed at young children and deletes a child's information on a guardian's request.
- **Sign in with Apple must be on whenever Google is.** Apple requires it (guideline 4.8). Set the Apple parameters in production before, or together with, the Google ones.

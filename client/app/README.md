# GamePlan client

Mobile-first Angular app for schedule, teams, and chat. Capacitor wraps the same
build for iOS and Android.

## Local website

From the repository root, start the full Compose stack (`npm run up`) and open
http://localhost:4200, or run the API on the laptop and:

```bash
npm start -w @gameplan/app
```

The app expects the API proxy at `http://localhost:3000` and the WebSocket at
`ws://localhost:3000/socket`.

## Capacitor

```bash
npm run build -w @gameplan/app
npm run cap:sync -w @gameplan/app
npm run cap:android -w @gameplan/app
npm run cap:ios -w @gameplan/app
```

Native projects live under `android/` and `ios/`. Push registration uses
`@capacitor/push-notifications` and stores the token with `PUT /media/devices/:id`
so fan-out can alert when no socket is open. Preferences holds the refresh token
on device.

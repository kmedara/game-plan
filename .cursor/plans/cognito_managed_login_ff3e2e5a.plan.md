---
name: Cognito managed login
overview: Turn the existing Cognito domain from classic Hosted UI to Managed login. Sign-in URLs and the app’s OAuth handoff stay the same.
todos:
  - id: set-managed-login
    content: Set managedLoginVersion to NEWER_MANAGED_LOGIN on the user pool domain in infrastructure/lib/auth.ts
    status: completed
isProject: false
---

# Switch Cognito to Managed login

The app already starts sign-in at `/identity/oauth/login`, which builds `https://<domain>/oauth2/authorize` in [functions/lib/auth/oauth.ts](functions/lib/auth/oauth.ts). Managed login uses those same authorize, token, and logout paths. No client or identity-route changes.

## Change

In [infrastructure/lib/auth.ts](infrastructure/lib/auth.ts), pass the newer version on the existing domain (CDK 2.220 already exports `ManagedLoginVersion`):

```ts
const domain = this.userPool.addDomain("HostedUi", {
  cognitoDomain: { domainPrefix },
  managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
});
```

Update the file’s comments that say “Hosted UI” where they describe this domain. Leave `hostedUiDomain`, `COGNITO_HOSTED_UI_DOMAIN`, and the OAuth URL builders as they are.

This CDK version has no managed-login branding construct. Cognito applies its default Managed login style. Logo and colors stay a console branding-editor step after deploy.

## Deploy note

`ManagedLoginVersion` updates in place on the existing `gameplan-<account>` prefix. After `cdk deploy`, the next Hosted UI sign-in should show the newer page. Local Compose still uses whatever domain is in the API env; it picks up the new UI once that env points at the updated pool.

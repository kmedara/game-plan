# Configuration

Where deploy and runtime settings live, and how they reach CDK, Terraform, Lambda, and the Expo web build. Feature-specific docs: [DNS](dns-and-hosting.md), [Stripe](stripe.md), [email](email.md), [store / EAS](store-release.md), [runtime secrets](security.md#secrets-at-run-time).

| Source | Who writes it | Who reads it |
| --- | --- | --- |
| **Parameter Store** (`<prefix>/…`) | You (AWS console or CLI) | Deploy job, CDK synth, Terraform, some Lambdas at runtime |
| **CloudFormation outputs** | `cdk deploy` | Same deploy job (website build, S3 sync, invalidation) |
| **Terraform state** | `terraform apply` | Stripe webhook secrets → SSM; EAS variables on expo.dev |
| **GitHub environment** | Repository settings | OIDC role, optional `AWS_REGION`, `SSM_PREFIX` |

Default prefix: **`/gameplan`** (`SSM_PREFIX` in CI). Staging and production each use a **separate AWS account** with the same parameter *names*, different *values*.

## Deploy pipeline

```text
GitHub Actions (DEPLOY_ENV, AWS_ROLE_ARN)
  → load-ssm-env.ts     … Parameter Store → job env (CDK + client build inputs)
  → cdk deploy --all    … stacks + cdk-outputs.json
  → load-outputs-env.ts … outputs → job env (API URL, bucket, distribution, …)
  → terraform apply     … Stripe webhooks, EAS vars (reads SSM itself)
  → client:build + s3 sync + CloudFront invalidation
```

- **Stack outputs never go back to Parameter Store.** That avoids a parameter lagging behind the last deploy.
- **Terraform-only parameters** (`stripe-api-key`, `expo-token`) are not exported to `$GITHUB_ENV`; only the Terraform step reads them.
- **Lambda runtime secrets** (Stripe secret key, VAPID private key, …) are usually **parameter names** on the function; values are read in-process ([`security.md`](security.md#secrets-at-run-time)).

Mapping code: [`infrastructure/lib/ssm-parameters.ts`](../infrastructure/lib/ssm-parameters.ts). Loaders: [`load-ssm-env.ts`](../infrastructure/scripts/load-ssm-env.ts), [`load-outputs-env.ts`](../infrastructure/scripts/load-outputs-env.ts).

## GitHub environments

| Name | When |
| --- | --- |
| `staging` | Push to `master`, or manual workflow with staging |
| `production` | GitHub **Release published**, or manual with production |

| Setting | Kind | Purpose |
| --- | --- | --- |
| `AWS_ROLE_ARN` | **Secret** | OIDC assume-role for deploy |
| `AWS_REGION` | Variable (optional) | Defaults to `us-east-1` |
| `SSM_PREFIX` | Variable (optional) | Defaults to `/gameplan` |

Required in Parameter Store before first deploy with DNS: **`hosted-zone-id`**, **`hosted-zone-name`** (see [dns-and-hosting.md](dns-and-hosting.md)).

## Parameter Store — deploy loader

These suffixes are loaded into the deploy job when listed in `PARAMETER_ENV` ([`ssm-parameters.ts`](../infrastructure/lib/ssm-parameters.ts)). All are **String** parameters unless noted.

| Suffix | Job env var | Used for |
| --- | --- | --- |
| `hosted-zone-id` | `HOSTED_ZONE_ID` | Route 53, CDK DNS stack |
| `hosted-zone-name` | `HOSTED_ZONE_NAME` | Hostname `<env>.<zone>`, Terraform, mail domain |
| `google-client-id` / `google-client-secret` | `GOOGLE_*` | Cognito Google IdP (all fields required to enable) |
| `facebook-app-id` / `facebook-app-secret` | `FACEBOOK_*` | Cognito Facebook IdP |
| `apple-client-id` / `apple-team-id` / `apple-key-id` / `apple-private-key` | `APPLE_*` | Cognito Apple IdP |
| `google-maps-api-key` | `GOOGLE_MAPS_API_KEY` | `places` Lambda (server geocoding); set by [terraform-google](../infrastructure/terraform-google/README.md) |
| `google-maps-browser-api-key` | `GOOGLE_MAPS_BROWSER_API_KEY` | Expo web/native maps (EAS via Terraform); set by [terraform-google](../infrastructure/terraform-google/README.md) |
| `vapid-public-key` / `vapid-private-key` / `vapid-subject` | `VAPID_*` | Web Push (private key also at runtime via SSM name) |
| `media-signing-public-key` | `MEDIA_SIGNING_PUBLIC_KEY` | Enables signed `/uploads/*` CDN behavior when set |
| `support-email` | `SUPPORT_EMAIL` | Privacy page (`EXPO_PUBLIC_SUPPORT_EMAIL` in builds) |
| `sms-origination-identity` | `SMS_ORIGINATION_IDENTITY` | SMS invites (AWS End User Messaging ARN) |
| `cognito-ses-email` | `COGNITO_SES_EMAIL` | `true` → Cognito sends mail through SES ([email.md](email.md)) |
| `mail-mx` / `mail-txt` / `mail-dmarc` / `mail-records` | `MAIL_*` | Production bare-domain mail DNS ([email.md](email.md)) |
| `staging-signup-allowlist` | `STAGING_SIGNUP_ALLOWLIST` | Staging Cognito pre-signup + SES sandbox recipients |

Parameters under the prefix that are **not** in this map are ignored by the loader (they may still be read by CDK, Terraform, or Lambda by full path).

## Parameter Store — other paths

Set by hand or by Terraform; not necessarily in the deploy job env:

| Suffix | Set by | Consumer |
| --- | --- | --- |
| `stripe-api-key` | Hand | Terraform Stripe provider (test vs live must match env) |
| `stripe-secret-key` | Hand | `payments`, `billing`, `orgs`, webhooks at runtime |
| `stripe-webhook-secret` | **Terraform** | Connect webhook verify |
| `stripe-billing-webhook-secret` | **Terraform** | Billing webhook verify |
| `expo-token` | Hand | Terraform → EAS ([terraform README](../infrastructure/terraform/README.md)) |
| `google-maps-android-api-key` | **Terraform** ([terraform-google](../infrastructure/terraform-google/README.md)) | Terraform → EAS Android maps |
| `ios-web-upgrade` | Hand | Terraform → `EXPO_PUBLIC_IOS_WEB_UPGRADE` ([store-release.md](store-release.md)) |
| `socket-origin-verify` | Hand | CloudFront custom header + socket authorizer (plain String; literal at deploy) |
| `media-signing-private-key` | Hand | `media` Lambda presigns |

Details: [stripe.md](stripe.md), [security.md](security.md#secrets-at-run-time).

## CDK stack outputs (same deploy job)

After `cdk deploy --outputs-file`, [`OUTPUT_ENV`](../infrastructure/lib/ssm-parameters.ts) maps outputs to:

| Output (logical id) | Env var | Purpose |
| --- | --- | --- |
| `HttpApiUrl` | `API_BASE_URL` | Expo web build |
| `SiteWebSocketUrl` | `WS_BASE_URL` | Expo web build |
| `SiteBucketName` | `SITE_BUCKET_NAME` | Upload static export |
| `SiteDistributionId` | `SITE_DISTRIBUTION_ID` | Invalidate `/*` |
| `TerraformStateBucketName` | `TF_STATE_BUCKET` | Terraform backend (also used in apply step) |

Webhook URLs (`PaymentsWebhookUrl`, `BillingWebhookUrl`) are read by Terraform from the **GamePlanApi** stack, not the website build.

## CDK context and local overrides

For a laptop `cdk deploy` or `cdk synth`, the same values can come from **environment variables** (after loading SSM) or **CDK context** (`-c googleClientId=…`) — see [`infrastructure/bin/app.ts`](../infrastructure/bin/app.ts).

Local API stack (`npm run up`): `AUTH_PROVIDER=local`, `LOCAL_JWT_SECRET`, optional env vars instead of SSM ([`api.md`](api.md#local-development)).

## Changing values

| Change | Action |
| --- | --- |
| Hosted zone, IdP, maps, VAPID, mail, allowlist | Update Parameter Store → re-run deploy (or workflow) |
| New CloudFront / API URLs | Automatic on `cdk deploy`; rebuild site step picks up outputs |
| Stripe products, webhooks, EAS vars | `terraform apply` after CDK ([stripe.md](stripe.md)) |
| Stripe webhook signing secret | Terraform rotate → Lambdas pick up within ~5 minutes |
| `socket-origin-verify` | New value in SSM + **site** deploy (header baked into distribution) |

**SecureString:** Runtime `readSecret` decrypts SecureString the same as String. The deploy loader uses non-decrypting `get-parameters-by-path`; prefer **String** for deploy-time parameters unless you load them differently. **`socket-origin-verify`** must stay String for CloudFront.

**IdP credentials** may also appear in the synthesized CloudFormation template during pool setup ([`security.md` — Gaps](security.md#known-gaps-and-trade-offs)).

## Key files

| Path | Role |
| --- | --- |
| `infrastructure/lib/ssm-parameters.ts` | Parameter and output maps |
| `infrastructure/scripts/load-ssm-env.ts` | CI: SSM → `$GITHUB_ENV` |
| `infrastructure/scripts/load-outputs-env.ts` | CI: CDK outputs → `$GITHUB_ENV` |
| `.github/workflows/deploy.yml` | Staging/production deploy |
| `infrastructure/terraform/` | Stripe + Expo after CDK |
| `functions/lib/parameters.ts` | Lambda runtime SSM reads |

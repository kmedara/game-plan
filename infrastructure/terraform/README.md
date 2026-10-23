# Stripe and Expo (Terraform)

The parts of GamePlan that live outside AWS: Stripe Billing plans, the two Stripe webhook endpoints, and the EAS environment variables for store builds. AWS stays in CDK (`infrastructure/lib`).

| File | What it manages |
| --- | --- |
| `stripe.tf` | Products and prices (by the lookup keys in `functions/billing/src/gateway.ts`), the payments (Connect) and billing webhook endpoints, and their signing secrets in Parameter Store |
| `expo.tf` | EAS variables from [store-release.md](../../docs/store-release.md), through the community `elevenode/expo` provider (pinned exactly). The project id and account come from `client/expo/app.json`. |

One state per environment. Staging uses Stripe test mode and the EAS `preview` environment; production uses live mode and EAS `production`. The Stripe key's mode is checked against `deploy_env`.

## Order

Apply **after** the CDK deploy. The webhook URLs are outputs of the `GamePlanApi` stack, and the website host comes from `<prefix>/hosted-zone-name`.

## One-time setup

1. An S3 bucket for state in each environment's AWS account, with versioning on. State holds the webhook signing secrets, so keep the bucket private.
2. If Stripe already has the products, prices, or webhooks from a manual setup:
   - **Prices** need no action. A new price takes the lookup key (`transfer_lookup_key`). Archive the old ones in the dashboard once no subscription uses them.
   - **EAS variables** cannot be imported. Delete any set by hand on expo.dev before the first apply, or creating them fails.
   - **Webhook endpoints** cannot be imported with their signing secret, because Stripe returns it only at creation. Let Terraform create new ones, then delete the old endpoints in the dashboard. The signing-secret parameters are overwritten, and functions pick up the new value within five minutes.

## Run

From `infrastructure/terraform`, with AWS credentials for the environment's account:

```sh
export TF_VAR_stripe_api_key=sk_test_...            # sk_live_... for production
export EXPO_TOKEN=...                               # expo.dev → Access tokens
export TF_VAR_google_maps_android_api_key=...       # optional

terraform init -backend-config=envs/staging.s3.tfbackend -backend-config="bucket=<state bucket>"
terraform apply -var-file=envs/staging.tfvars
```

Use `-reconfigure` when switching between environments in the same checkout.

`terraform test` plans against mocked providers and needs no credentials.

## Changing things

- **A price.** Change `unit_amount` in `stripe.tf` and the copy in `client/expo/src/en.json` and `es.json`. Stripe prices cannot change amount, so this creates a new price that takes the lookup key. Existing subscribers stay on the old price, which no longer has a lookup key, and the billing webhook skips their events (`unknown_plan_or_pending`) until they are moved to the new price.
- **A webhook event.** Add it to the list in `stripe.tf` and to the switch in that area's `webhook.ts`.
- **An EAS variable.** Add it to `eas_visibility` and `eas_values` in `expo.tf`. A variable deleted on expo.dev makes the next plan fail, because the provider does not treat it as gone; remove it with `terraform state rm 'expo_app_variable.build["<NAME>"]'` and apply again.
- **The Expo provider.** It is pinned to one version because it is a single maintainer's provider and holds `EXPO_TOKEN`. Read its changelog before raising the pin, and run `terraform providers lock` for linux, windows, and darwin afterwards.

## Not managed here

- The Stripe secret key the functions use (`<prefix>/stripe-secret-key`). Stripe issues keys only in the dashboard.
- The billing portal. The code uses the account's default portal configuration, and this provider cannot set which configuration is the default.
- EAS signing credentials and push keys (`eas credentials`), and the GitHub variables `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256`.

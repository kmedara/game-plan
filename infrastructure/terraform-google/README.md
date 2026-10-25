# Google Maps keys (Terraform)

The three Google Maps Platform keys for one environment, with their API and application restrictions, written to the Parameter Store names their consumers already read. The **Google Maps keys** workflow applies it on demand; the deploy workflow does not run it.

| Key | Allowed APIs | Restricted to | Parameter | Read by |
| --- | --- | --- | --- | --- |
| Server | Places (New), Geocoding, Maps Static | APIs only (Lambda has no fixed IP) | `<prefix>/google-maps-api-key` | `places` Lambda, at run time |
| Browser | Maps JavaScript | `https://<environment>.<zone>/*` plus `browser_extra_referrers` | `<prefix>/google-maps-browser-api-key` | Deploy → website build and EAS (`infrastructure/terraform/expo.tf`) |
| Android | Maps SDK for Android | `com.gameplan.app` (from `app.json`) and each `android_cert_sha1` | `<prefix>/google-maps-android-api-key` | `expo.tf` → EAS |

The Android key is created only once `android_cert_sha1` has a fingerprint, so there is never an unrestricted one.

It is separate from `infrastructure/terraform` because the deploy loads the browser key before Terraform runs there, and because the keys change about once a year. A new key reaches the website and EAS on the next deploy, and the places Lambda within five minutes.

## One-time setup

1. A Google Cloud project per environment (or one shared by both), with billing on. Put its project id in `gcp_project_id` in `envs/<environment>.tfvars`. Terraform turns on the APIs it needs and never turns them off.
2. GitHub access to Google Cloud, without a stored key. Signed in with `gcloud auth login` as a project owner, run:

   ```sh
   bash infrastructure/terraform-google/scripts/github-oidc.sh
   ```

   It creates a workload identity pool that trusts only this repository's `staging` and `production` environments, and a `gameplan-maps-keys` service account that can turn on APIs and manage API keys and nothing else. Set the two repository variables it prints: `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`.
3. On the deploy role (`AWS_ROLE_ARN`), beyond what [`infrastructure/terraform`](../terraform/README.md) already needs: `ssm:GetParameter` on `<prefix>/hosted-zone-name`, and `cloudformation:DescribeStacks` on `GamePlanPlatform` for the state bucket name.
4. For Android, once the app is on Play: Play Console → App integrity → App signing, then add the **SHA-1** of the app signing key and of the upload key to `android_cert_sha1`. These are not the SHA-256 values in the `ANDROID_CERT_SHA256` GitHub variable.

Parameters set by hand earlier are taken over (`overwrite`). Delete the old keys in the Cloud Console once a deploy has picked up the new ones.

## Run

Actions → **Google Maps keys** → Run workflow, with the environment. It only plans unless **Apply** is ticked, so run it once without to read the plan. If an environment has required reviewers, the run waits for them, as a deploy does. After an apply, run **Deploy** for the same environment so the website and EAS get the keys.

### By hand

From `infrastructure/terraform-google`, with `gcloud auth application-default login` (the same two roles on the project) and AWS credentials for the environment's account:

```sh
bucket=$(aws cloudformation describe-stacks --stack-name GamePlanPlatform \
  --query "Stacks[0].Outputs[?OutputKey=='TerraformStateBucketName'].OutputValue" --output text)
terraform init -backend-config=envs/staging.s3.tfbackend -backend-config="bucket=$bucket"
terraform apply -var-file=envs/staging.tfvars
```

Then re-run the deploy so the website and EAS get the browser and Android keys. Use `-reconfigure` when switching environments in the same checkout.

`terraform test` plans against mocked providers and needs no credentials.

## Changing things

- **A Maps API the code starts calling.** Add it to `key_apis` in `main.tf` for the key that calls it. Without it, Google rejects the request with `API_KEY_SERVICE_BLOCKED`.
- **Rotating a key.** `terraform apply -replace='google_apikeys_key.server'` (or `browser`, `android`), then deploy. The old key is deleted at once, so the website map breaks until the deploy finishes.

## Not managed here

The Google OAuth client for Sign in with Google (`<prefix>/google-client-id` and `google-client-secret`) and its consent screen. Google has no public API for either: create them in the Cloud Console ([store-release.md](../../docs/store-release.md)).

#!/usr/bin/env bash
# Lets the "Google Maps keys" workflow act on the Google Cloud project without a
# stored key: GitHub's OIDC token is exchanged for a short-lived service account token.
#
# Usage: bash infrastructure/terraform-google/scripts/github-oidc.sh [project-id] [owner/repo]
# Run once, signed in with `gcloud auth login` as a project owner. Safe to re-run.
#
# Only jobs from this repository that run in the staging or production GitHub
# environment can use the service account, so environment protection rules apply.

set -euo pipefail

PROJECT_ID="${1:-project-49199944-d3a9-4956-84c}"
REPO="${2:-kmedara/game-plan}"
POOL="github"
PROVIDER="github"
ACCOUNT="gameplan-maps-keys"
ACCOUNT_EMAIL="${ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"
ENVIRONMENTS=(staging production)

PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')

# IAM, IAM Credentials and STS for the token exchange; the rest for Terraform itself.
gcloud services enable --project="${PROJECT_ID}" \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com apikeys.googleapis.com

if ! gcloud iam workload-identity-pools describe "${POOL}" --project="${PROJECT_ID}" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL}" --project="${PROJECT_ID}" --location=global \
    --display-name="GitHub Actions"
fi

# The condition rejects tokens from every other repository before any binding is checked.
if ! gcloud iam workload-identity-pools providers describe "${PROVIDER}" --project="${PROJECT_ID}" \
  --location=global --workload-identity-pool="${POOL}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER}" --project="${PROJECT_ID}" \
    --location=global --workload-identity-pool="${POOL}" \
    --display-name="GitHub" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment" \
    --attribute-condition="assertion.repository == '${REPO}'"
fi

if ! gcloud iam service-accounts describe "${ACCOUNT_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${ACCOUNT}" --project="${PROJECT_ID}" \
    --display-name="GamePlan Maps keys (GitHub Actions)"
fi

# Turn on APIs, and create and restrict API keys. Nothing else in the project.
for role in roles/serviceusage.serviceUsageAdmin roles/serviceusage.apiKeysAdmin; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" --condition=None --quiet \
    --member="serviceAccount:${ACCOUNT_EMAIL}" --role="${role}" >/dev/null
done

POOL_PATH="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
for environment in "${ENVIRONMENTS[@]}"; do
  gcloud iam service-accounts add-iam-policy-binding "${ACCOUNT_EMAIL}" --project="${PROJECT_ID}" --quiet \
    --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/${POOL_PATH}/attribute.environment/${environment}" >/dev/null
done

cat <<EOF

Set these GitHub repository variables (Settings -> Secrets and variables -> Actions -> Variables):

  GCP_WORKLOAD_IDENTITY_PROVIDER = ${POOL_PATH}/providers/${PROVIDER}
  GCP_SERVICE_ACCOUNT            = ${ACCOUNT_EMAIL}

Or with the GitHub CLI:

  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo ${REPO} --body "${POOL_PATH}/providers/${PROVIDER}"
  gh variable set GCP_SERVICE_ACCOUNT --repo ${REPO} --body "${ACCOUNT_EMAIL}"
EOF

#!/usr/bin/env bash
set -euo pipefail

# One-time GCP Pub/Sub Push & 3-Day Cloud Scheduler setup for Guest Co-Host (Stage 5)
# Usage:
#   GOOGLE_CLOUD_PROJECT=your-project \
#   CLOUD_RUN_URL=https://cohost-xxxxx-uc.a.run.app \
#   REGION=us-central1 \
#   ./scripts/setup-gcp-triggers.sh

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT}"
CLOUD_RUN_URL="${CLOUD_RUN_URL:?Set CLOUD_RUN_URL (no trailing slash)}"
REGION="${REGION:-us-central1}"

TOPIC_NAME="cohost-gmail-push"
SUBSCRIPTION_NAME="cohost-gmail-push-sub"
PUBSUB_SA="cohost-pubsub-push@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA="cohost-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_JOB="cohost-renew-gmail-watch"

echo "1. Creating Pub/Sub topic (${TOPIC_NAME}) and granting Gmail API publish access..."
gcloud pubsub topics create "${TOPIC_NAME}" --project="${PROJECT_ID}" || true
gcloud pubsub topics add-iam-policy-binding "${TOPIC_NAME}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

echo "2. Creating dedicated OIDC service accounts..."
gcloud iam service-accounts create cohost-pubsub-push \
  --project="${PROJECT_ID}" \
  --display-name="Guest Co-Host Pub/Sub Push Invoker" || true

gcloud iam service-accounts create cohost-scheduler \
  --project="${PROJECT_ID}" \
  --display-name="Guest Co-Host 3-Day Watch Renewal Invoker" || true

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
echo "2b. Allowing Google Pub/Sub service agent to mint OIDC tokens for ${PUBSUB_SA}..."
gcloud iam service-accounts add-iam-policy-binding "${PUBSUB_SA}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

echo "3. Creating authenticated Pub/Sub push subscription -> /api/internal/gmail-push..."
gcloud pubsub subscriptions create "${SUBSCRIPTION_NAME}" \
  --project="${PROJECT_ID}" \
  --topic="${TOPIC_NAME}" \
  --push-endpoint="${CLOUD_RUN_URL}/api/internal/gmail-push" \
  --push-auth-service-account="${PUBSUB_SA}" \
  --push-auth-token-audience="${CLOUD_RUN_URL}" \
  --ack-deadline=60 || true

echo "4. Creating 3-day Cloud Scheduler job -> /api/internal/renew-watch..."
gcloud scheduler jobs create http "${SCHEDULER_JOB}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --schedule="0 9 */3 * *" \
  --uri="${CLOUD_RUN_URL}/api/internal/renew-watch" \
  --http-method=POST \
  --oidc-service-account-email="${SCHEDULER_SA}" \
  --oidc-token-audience="${CLOUD_RUN_URL}" || true

echo "Done. Verify INTERNAL_OIDC_AUDIENCE=${CLOUD_RUN_URL} is set on the Cloud Run service."

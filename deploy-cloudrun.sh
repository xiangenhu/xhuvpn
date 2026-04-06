#!/usr/bin/env bash
# deploy-cloudrun.sh — Build and deploy to Cloud Run
# Usage: bash deploy-cloudrun.sh <project-id> <gcs-bucket> <vm-ip> <domain>
set -euo pipefail

PROJECT="${1:?Usage: deploy-cloudrun.sh <project-id> <gcs-bucket> <vm-ip> <domain>}"
BUCKET="${2:?}"
VM_IP="${3:?}"
DOMAIN="${4:?}"
REGION="us-central1"
SERVICE="vpn-manager"
VM_USER="ubuntu"

echo "==> Building and pushing container via Cloud Build..."
gcloud builds submit \
  --tag "gcr.io/$PROJECT/$SERVICE" \
  --project "$PROJECT"

echo "==> Creating Cloud Run service account (if needed)..."
SA_NAME="vpn-manager-sa"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$SA_NAME" \
  --display-name="VPN Manager Cloud Run SA" 2>/dev/null || echo "  SA already exists."

# Grant access to GCS bucket
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin"

# Grant access to secrets
for SECRET in vpn-ssh-private-key vpn-api-secret; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"
done

echo "==> Deploying to Cloud Run..."
gcloud run deploy "$SERVICE" \
  --image "gcr.io/$PROJECT/$SERVICE" \
  --platform managed \
  --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars "\
GCS_BUCKET=$BUCKET,\
GCE_HOST=$VM_IP,\
GCE_USER=$VM_USER,\
SERVER_ENDPOINT=$DOMAIN,\
WG_INTERFACE=wg0,\
SERVER_PORT=51820,\
VPN_SUBNET=10.8.0,\
SSH_KEY_SECRET=vpn-ssh-private-key,\
API_KEY_SECRET=vpn-api-secret,\
GOOGLE_CLOUD_PROJECT=$PROJECT"

SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --format='value(status.url)')

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Cloud Run Deployment Complete!                          ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Service URL : $SERVICE_URL"
echo "║  Custom domain: https://$DOMAIN  (map via Cloud Run UI)"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  To map your domain:"
echo "  gcloud run domain-mappings create --service $SERVICE --domain $DOMAIN --region $REGION"

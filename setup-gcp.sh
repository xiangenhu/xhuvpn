#!/usr/bin/env bash
# setup-gcp.sh — Run ONCE from Git Bash on Windows before first deploy
# Usage: bash setup-gcp.sh <project-id> <vm-name> <vm-zone> <your-domain>
set -euo pipefail

PROJECT="${1:?Usage: setup-gcp.sh <project-id> <vm-name> <vm-zone> <domain>}"
VM_NAME="${2:?}"
VM_ZONE="${3:?}"
DOMAIN="${4:?}"

echo "==> [1/7] Setting project..."
gcloud config set project "$PROJECT"

echo "==> [2/7] Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

echo "==> [3/7] Creating GCS bucket for VPN data..."
BUCKET="${PROJECT}-vpn-data"
gcloud storage buckets create "gs://$BUCKET" \
  --location=us-central1 \
  --uniform-bucket-level-access 2>/dev/null || echo "  Bucket already exists."

echo "==> [4/7] Generating SSH keypair for Cloud Run → GCE VM..."
SSH_KEY_FILE="$HOME/.ssh/vpn-cloudrun-key"
if [ ! -f "$SSH_KEY_FILE" ]; then
  ssh-keygen -t ed25519 -f "$SSH_KEY_FILE" -N "" -C "vpn-cloudrun"
fi

echo "==> [5/7] Storing SSH private key in Secret Manager..."
gcloud secrets create vpn-ssh-private-key \
  --data-file="$SSH_KEY_FILE" 2>/dev/null || \
gcloud secrets versions add vpn-ssh-private-key \
  --data-file="$SSH_KEY_FILE"

echo "==> [6/7] Generating and storing API secret..."
API_SECRET=$(openssl rand -hex 32)
echo -n "$API_SECRET" | gcloud secrets create vpn-api-secret \
  --data-file=- 2>/dev/null || \
echo -n "$API_SECRET" | gcloud secrets versions add vpn-api-secret \
  --data-file=-
echo ""
echo "  ⚠  API Secret (save this): $API_SECRET"
echo ""

echo "==> [7/7] Adding SSH public key to GCE VM..."
VM_USER="ubuntu"
PUB_KEY=$(cat "${SSH_KEY_FILE}.pub")
gcloud compute ssh "$VM_NAME" --zone="$VM_ZONE" \
  --command="echo '$PUB_KEY' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

echo ""
echo "==> Installing WireGuard on VM (if not already present)..."
gcloud compute ssh "$VM_NAME" --zone="$VM_ZONE" \
  --command="sudo apt-get update -qq && sudo apt-get install -y wireguard wireguard-tools && sudo sysctl -w net.ipv4.ip_forward=1 && grep -q 'ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' | sudo tee -a /etc/sysctl.conf"

echo ""
echo "==> Opening UDP 51820 firewall on GCE VM..."
gcloud compute firewall-rules create allow-wireguard \
  --allow udp:51820 \
  --target-tags=wireguard 2>/dev/null || echo "  Firewall rule already exists."

gcloud compute instances add-tags "$VM_NAME" \
  --zone="$VM_ZONE" --tags=wireguard

VM_IP=$(gcloud compute instances describe "$VM_NAME" \
  --zone="$VM_ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  GCP Setup Complete!                                     ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  GCS Bucket   : $BUCKET"
echo "║  VM IP        : $VM_IP"
echo "║  VM User      : $VM_USER"
echo "║  API Secret   : $API_SECRET"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Next: set your domain A record → $VM_IP"
echo "║  Then: bash deploy-cloudrun.sh $PROJECT $BUCKET $VM_IP $DOMAIN"
echo "╚══════════════════════════════════════════════════════════╝"

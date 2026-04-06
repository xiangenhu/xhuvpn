# WireGuard VPN Manager — Cloud Run Edition
### Node.js · Cloud Run · Google Cloud Storage · GCE VM (WireGuard)

---

## Architecture

```
Browser / WireGuard Client
         │
         ▼
  Cloud Run (this app)          ← stateless Node.js, auto-scales
    ├── GET/POST /api/peers
    ├── Reads/writes JSON  ───► GCS Bucket  (peers.json, server-keys.json)
    └── SSH on peer change ───► GCE VM  ──► wg0 (WireGuard, UDP 51820)
                                             └── tunnels all client traffic
```

- **No local disk** — all state in GCS
- **Secrets** — SSH private key and API secret stored in Secret Manager
- **TLS** — Cloud Run provides HTTPS automatically; map your domain in Cloud Run UI

---

## Prerequisites (Windows)

| Tool | Download |
|------|----------|
| Google Cloud CLI (`gcloud`) | https://cloud.google.com/sdk/docs/install |
| Git Bash (or Windows Terminal) | https://git-scm.com |
| WireGuard for Windows | https://www.wireguard.com/install/ |

After installing `gcloud`, open **Git Bash** and run:
```bash
gcloud auth login
gcloud auth configure-docker
```

---

## Step 1 — One-time GCP Setup

In Git Bash, `cd` to this folder, then run:

```bash
bash setup-gcp.sh MY_PROJECT_ID MY_VM_NAME MY_VM_ZONE vpn.yourdomain.com
```

Example:
```bash
bash setup-gcp.sh my-project vpn-host us-central1-a vpn.example.com
```

This script will:
- Enable Cloud Run, Secret Manager, GCS, Cloud Build APIs
- Create a GCS bucket `MY_PROJECT_ID-vpn-data`
- Generate an SSH keypair and store it in Secret Manager
- Generate a random API secret and store it in Secret Manager  ← **save the printed value**
- Install WireGuard on your VM
- Open UDP 51820 firewall rule

---

## Step 2 — Deploy to Cloud Run

```bash
bash deploy-cloudrun.sh MY_PROJECT_ID MY_PROJECT_ID-vpn-data VM_IP vpn.yourdomain.com
```

This will:
- Build the Docker image via Cloud Build
- Create a service account with GCS + Secret Manager permissions
- Deploy to Cloud Run in us-central1
- Print the service URL

---

## Step 3 — Map Your Domain (optional but recommended)

```bash
gcloud run domain-mappings create \
  --service vpn-manager \
  --domain vpn.yourdomain.com \
  --region us-central1
```

Then add a CNAME record in your DNS:
```
Type:  CNAME
Name:  vpn
Value: ghs.googlehosted.com
```

Or simply use the `*.run.app` URL Cloud Run provides — it has TLS automatically.

---

## Step 4 — Add Your Windows PC as a Peer

**Option A — Browser UI:**
1. Open your Cloud Run URL or `https://vpn.yourdomain.com`
2. Enter the API secret printed in Step 1
3. Click **+ Add Peer**, name it `windows-pc`
4. Download the `.conf` file (or scan the QR code on mobile)

**Option B — curl (Git Bash):**
```bash
curl -X POST https://YOUR-CLOUDRUN-URL/api/peers \
  -H "x-api-key: YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"windows-pc\"}"
```

---

## Step 5 — Connect WireGuard on Windows

1. Open **WireGuard for Windows**
2. Click **Import tunnel(s) from file**
3. Select `windows-pc.conf`
4. Click **Activate**

Verify at https://whatismyip.com — should show your VM's IP.

---

## GCS Data Layout

```
gs://MY_PROJECT_ID-vpn-data/
├── server-keys.json   # WireGuard server keypair
└── peers.json         # All peer configs (including private keys)
```

> Both files are private by default (uniform bucket-level access).
> Only the Cloud Run service account can read/write them.

---

## Secret Manager Secrets

| Secret Name | Contents |
|-------------|----------|
| `vpn-ssh-private-key` | Ed25519 private key for SSH into GCE VM |
| `vpn-api-secret` | API authentication token for management UI |

---

## API Reference

All endpoints require header: `x-api-key: YOUR_SECRET`

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/status` | — | WireGuard interface status |
| GET | `/api/peers` | — | List peers (no private keys) |
| POST | `/api/peers` | `{"name":"..."}` | Config + QR code |
| DELETE | `/api/peers/:name` | — | Confirmation |
| GET | `/api/peers/:name/config` | — | Download `.conf` file |
| GET | `/health` | — | Health check (Cloud Run probe) |

---

## VS Code / Claude Code Workflow

```bash
# After making code changes in VS Code:
bash deploy-cloudrun.sh MY_PROJECT MY_BUCKET VM_IP vpn.yourdomain.com

# Or just re-run Cloud Build manually:
gcloud builds submit --tag gcr.io/MY_PROJECT/vpn-manager

gcloud run deploy vpn-manager \
  --image gcr.io/MY_PROJECT/vpn-manager \
  --region us-central1
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| SSH connection refused | Check GCE VM firewall allows TCP 22; verify VM is running |
| `getSecret` fails | Verify service account has `secretmanager.secretAccessor` role |
| GCS permission denied | Verify service account has `storage.objectAdmin` on the bucket |
| WireGuard not connecting | Check UDP 51820 open on VM; run `sudo wg show wg0` via SSH |
| Cloud Run cold start slow | First request after idle spins up — normal for free tier |

---

## Cost Estimate

| Resource | Monthly Cost |
|----------|-------------|
| Cloud Run (low traffic) | **~$0** (2M req free tier) |
| GCS (< 1 GB) | **~$0** (5 GB free tier) |
| Secret Manager | **~$0** (< 6 active secrets free) |
| GCE e2-micro VM | **$0** (free tier, us-central1) |
| Egress > 1 GB | ~$0.08/GB |

---

## File Structure

```
vpn-manager/
├── server.js              # Express app — GCS + SSH + WireGuard logic
├── package.json           # Dependencies
├── Dockerfile             # Cloud Run container
├── .dockerignore
├── setup-gcp.sh           # One-time GCP provisioning
├── deploy-cloudrun.sh     # Build + deploy to Cloud Run
├── README.md              # This file
└── public/
    └── index.html         # Browser management UI
```

---

*Generated by Claude · April 2026*

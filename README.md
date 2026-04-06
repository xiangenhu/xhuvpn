# WireGuard VPN Manager — Cloud Run Edition
### Node.js · Cloud Run · Google Cloud Storage · GCE VM (WireGuard)

---

## Architecture

```
Browser / WireGuard Client
         |
         v
  Cloud Run (this app)          <-- stateless Node.js, auto-scales
    |-- GET/POST /api/peers
    |-- Reads/writes JSON  ---> GCS Bucket  (peers.json, server-keys.json)
    +-- SSH on peer change ---> GCE VM  --> wg0 (WireGuard, UDP 51820)
                                             +-- tunnels all client traffic
```

- **No local disk** -- all state in GCS
- **Secrets** -- SSH private key and API secret stored in Secret Manager
- **TLS** -- Cloud Run provides HTTPS automatically; map your domain in Cloud Run UI

---

## Prerequisites

| Tool | Download |
|------|----------|
| Google Cloud CLI (`gcloud`) | https://cloud.google.com/sdk/docs/install |
| Git Bash (or Windows Terminal) | https://git-scm.com |
| Node.js >= 20 | https://nodejs.org |
| WireGuard Client | https://www.wireguard.com/install/ |

After installing `gcloud`, run:
```bash
gcloud auth login
gcloud auth configure-docker
```

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to GCP service account key JSON | Yes (local only) |
| `GOOGLE_CLOUD_PROJECT` | Your GCP project ID | Yes |
| `GCS_BUCKET` | GCS bucket name for VPN data | Yes |
| `GCE_HOST` | GCE VM external IP or hostname | Yes |
| `SERVER_ENDPOINT` | Your VPN domain (e.g. vpn.example.com) | Yes |
| `GCE_USER` | SSH user on the VM | No (default: `ubuntu`) |
| `WG_INTERFACE` | WireGuard interface name | No (default: `wg0`) |
| `SERVER_PORT` | WireGuard listen port | No (default: `51820`) |
| `VPN_SUBNET` | VPN subnet prefix | No (default: `10.8.0`) |
| `PORT` | HTTP server port | No (default: `8080`) |
| `SSH_KEY_SECRET` | Secret Manager name for SSH key | No (default: `vpn-ssh-private-key`) |
| `API_KEY_SECRET` | Secret Manager name for API token | No (default: `vpn-api-secret`) |

### 3. Run the server

```bash
npm start        # production
npm run dev      # with auto-reload (nodemon)
```

The app will be available at `http://localhost:8080` (or whatever `PORT` is set to).

### 4. Verify health

```bash
curl http://localhost:8080/health
# {"ok":true,"gcs":"reachable"}
```

---

## GCP Setup (One-Time)

In your terminal, `cd` to this folder, then run:

```bash
bash setup-gcp.sh <project-id> <vm-name> <vm-zone> <your-domain>
```

Example:
```bash
bash setup-gcp.sh my-project vpn-host us-central1-a vpn.example.com
```

This script will:
1. Enable Cloud Run, Secret Manager, GCS, Cloud Build APIs
2. Create a GCS bucket `<project-id>-vpn-data`
3. Generate an SSH keypair and store it in Secret Manager
4. Generate a random API secret and store it in Secret Manager -- **save the printed value**
5. Install WireGuard on your VM
6. Open UDP 51820 firewall rule

---

## Deploy to Cloud Run

```bash
bash deploy-cloudrun.sh <project-id> <gcs-bucket> <vm-ip> <your-domain>
```

This will:
1. Build the Docker image via Cloud Build
2. Create a service account with GCS + Secret Manager permissions
3. Deploy to Cloud Run in us-central1
4. Print the service URL

---

## Map Your Domain (Optional)

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

Or simply use the `*.run.app` URL Cloud Run provides -- it has TLS automatically.

---

## Add a Peer (VPN Client)

**Option A -- Browser UI:**
1. Open your Cloud Run URL or `https://vpn.yourdomain.com`
2. Enter the API secret printed during GCP setup
3. Click **+ Add Peer**, name it (e.g. `windows-pc`)
4. Download the `.conf` file or scan the QR code on mobile

**Option B -- curl:**
```bash
curl -X POST https://YOUR-CLOUDRUN-URL/api/peers \
  -H "x-api-key: YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name": "windows-pc"}'
```

---

## Connect WireGuard Client

1. Open **WireGuard** on your device
2. Import the downloaded `.conf` file
3. Activate the tunnel
4. Verify at https://whatismyip.com -- should show your VM's IP

---

## API Reference

All endpoints require header: `x-api-key: YOUR_SECRET`

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/status` | -- | WireGuard interface status |
| GET | `/api/peers` | -- | List peers (no private keys) |
| POST | `/api/peers` | `{"name":"..."}` | Config + QR code |
| DELETE | `/api/peers/:name` | -- | Confirmation |
| GET | `/api/peers/:name/config` | -- | Download `.conf` file |
| GET | `/health` | -- | Health check with GCS verification |

---

## GCS Data Layout

```
gs://<project-id>-vpn-data/
|-- server-keys.json   # WireGuard server keypair
+-- peers.json         # All peer configs (including private keys)
```

Both files are private by default (uniform bucket-level access). Only the Cloud Run service account can read/write them.

---

## Secret Manager Secrets

| Secret Name | Contents |
|-------------|----------|
| `vpn-ssh-private-key` | Ed25519 private key for SSH into GCE VM |
| `vpn-api-secret` | API authentication token for management UI |

---

## Docker

Build and run locally:
```bash
docker build -t vpn-manager .
docker run -p 8080:8080 --env-file .env vpn-manager
```

Or build and push via Cloud Build:
```bash
gcloud builds submit --tag gcr.io/MY_PROJECT/vpn-manager
```

---

## File Structure

```
xhuvpn/
|-- server.js              # Express app -- GCS + SSH + WireGuard logic
|-- package.json           # Dependencies
|-- Dockerfile             # Cloud Run container (multi-stage build)
|-- .dockerignore
|-- .env.example           # Environment variable template
|-- setup-gcp.sh           # One-time GCP provisioning
|-- deploy-cloudrun.sh     # Build + deploy to Cloud Run
+-- public/
    +-- index.html         # Browser management UI (self-contained SPA)
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| SSH connection refused | Check GCE VM firewall allows TCP 22; verify VM is running |
| `getSecret` fails | Verify service account has `secretmanager.secretAccessor` role |
| GCS permission denied | Verify service account has `storage.objectAdmin` on the bucket |
| WireGuard not connecting | Check UDP 51820 open on VM; run `sudo wg show wg0` via SSH |
| Cloud Run cold start slow | First request after idle spins up -- normal for free tier |
| Health check returns 503 | Check `GCS_BUCKET` env var and `GOOGLE_APPLICATION_CREDENTIALS` path |
| `localhost` refused in Codespace | Use the forwarded port URL from the Ports tab, not localhost |

---

## Cost Estimate

| Resource | Monthly Cost |
|----------|-------------|
| Cloud Run (low traffic) | ~$0 (2M req free tier) |
| GCS (< 1 GB) | ~$0 (5 GB free tier) |
| Secret Manager | ~$0 (< 6 active secrets free) |
| GCE e2-micro VM | $0 (free tier, us-central1) |
| Egress > 1 GB | ~$0.08/GB |

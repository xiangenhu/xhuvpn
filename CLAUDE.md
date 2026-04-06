# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

WireGuard VPN Manager — a Node.js/Express app deployed on Google Cloud Run that manages WireGuard VPN peers on a remote GCE VM. All state is stored externally (no local disk).

## Commands

```bash
npm start          # Run the server (production)
npm run dev        # Run with nodemon (auto-reload on changes)
```

### Deploying

```bash
# One-time GCP setup (APIs, bucket, secrets, WireGuard on VM)
bash setup-gcp.sh <project-id> <vm-name> <vm-zone> <domain>

# Build container and deploy to Cloud Run
bash deploy-cloudrun.sh <project-id> <gcs-bucket> <vm-ip> <domain>
```

## Architecture

```
Browser → Cloud Run (server.js, stateless)
            ├── REST API + static UI (public/index.html)
            ├── Reads/writes state → GCS Bucket (peers.json, server-keys.json)
            ├── Fetches secrets → GCP Secret Manager (SSH key, API token)
            └── SSH on peer change → GCE VM → wg0 (WireGuard, UDP 51820)
```

**server.js** is the entire backend — a single Express app handling:
- API-key auth middleware (validates against Secret Manager)
- CRUD for peers (`/api/peers`, `/api/peers/:name`, `/api/peers/:name/config`)
- Server status via SSH (`/api/status`)
- WireGuard config generation and hot-reload on the VM via SSH
- WireGuard keypair generation on the VM (Cloud Run lacks `wg` binary)

**public/index.html** is a self-contained SPA (no build step) with login, peer management, QR code display, and `.conf` download.

## Environment

Configured via `.env` locally (see `.env.example`) or Cloud Run env vars in production. Key variables:
- `GOOGLE_APPLICATION_CREDENTIALS` — path to GCP service account key JSON (local dev only)
- `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`, `GCE_HOST`, `SERVER_ENDPOINT` — required
- `GCE_USER`, `WG_INTERFACE`, `SERVER_PORT`, `VPN_SUBNET` — have defaults

## GCP Dependencies

- **Cloud Run** — hosts the app
- **Cloud Storage** — `peers.json` and `server-keys.json`
- **Secret Manager** — `vpn-ssh-private-key` and `vpn-api-secret`
- **GCE VM** — runs WireGuard, managed via SSH from Cloud Run

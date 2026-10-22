# Owner-only administration through SKO

Only the Google identity `xiangenhu@gmail.com` can administer this VPN manager.
The restriction is hard-coded and enforced server-side on every admin route; invitation codes cannot grant administrator access.
There is no API-key, email/password or browser bearer-token fallback.

## Invite friends and disable users

- Sign in as the owner. In **Friends and invitations**, enter the friend's Google email and choose **Generate invitation**.
- Copy the private invitation URL or code. Codes are displayed only at creation, stored as SHA-256 hashes, single-use and expire after seven days. Reissuing an invitation invalidates that email's previous code. URLs keep the code in their fragment; redemption sends it in a POST body, not a URL query.
- The friend opens the link (or pastes the code), then signs in through SKO with the matching Google email. A different email cannot redeem it. Thereafter the active friend can sign in normally without reusing the code.
- Members can manage only their own devices, with three devices per member. The owner can manage all devices. There are at most nine active/pending friends plus the owner.
- **Disable** cancels outstanding invitations, invalidates that user's portal access on their next request, and removes all their device keys from the desired VPN configuration. It then synchronizes the VM. If this fails, the dashboard explicitly warns that existing tunnels may still work; use **Retry VPN synchronization** until it succeeds. The sole administrator cannot be disabled. Disabled users cannot redeem or receive new invitations; re-enabling is not offered in this version.
- On phones/tablets use the official WireGuard client and QR code; on desktops import the configuration. Treat configurations as credentials and share them privately.

Google sign-in, invitation delivery and VPN connectivity are separate. The portal still uses WireGuard: these changes do not establish reliable mainland connectivity or replace target-device testing.

## Activate

1. In https://oauth.skoonline.org/genai/#administration, register client `xhuvpn`, enable OAuth, and register the exact callback `https://YOUR_VPN_PORTAL/api/auth/oauth/callback`.
2. Configure `APP_URL` as that HTTPS portal origin (no path or trailing slash), and `PROXY_CLIENT_ID=xhuvpn`.
3. Store the proxy-generated client secret in Secret Manager; mount it as `PROXY_CLIENT_SECRET`. Generate a separate 32-byte random hex value (`openssl rand -hex 32`), store it securely, and mount it as `SESSION_ENCRYPTION_KEY`. Never put either secret in Git or the browser.
4. Keep the configured GCS bucket private. Its existing service account needs object read/create/delete permissions for `auth/`. Configure a lifecycle deletion rule scoped ONLY to prefix `auth/` to remove records older than one day. Do not apply this rule to peers or server keys. Application expiry is enforced independently.
5. Deploy and sign in using the owner's Google account. Verify an uninvited account is denied, then invite a friend and confirm they cannot access administration. Verify device creation/config download/removal against the actual VM.

Example addition to your existing deployment (replace names with your actual secrets):

```sh
gcloud run services update vpn-manager --region us-central1 \
  --update-env-vars APP_URL=https://YOUR_VPN_PORTAL,PROXY_CLIENT_ID=xhuvpn \
  --update-secrets PROXY_CLIENT_SECRET=xhuvpn-proxy-secret:latest,SESSION_ENCRYPTION_KEY=xhuvpn-session-key:latest
```

Grant the runtime service account access to these secrets first. New secret versions require a new Cloud Run revision. Rotating the session key invalidates existing logins. Rotating the proxy client secret requires updating its Secret Manager value and redeploying; existing app sessions last up to eight hours, so rotate the session key too to invalidate them immediately.

## Implementation and checks

Uses the proxy's documented `/genai/services/oauth/start` and `/token` contract from https://oauth.skoonline.org/generalInstruction, retrieved 2026-10-22. PKCE and state are encrypted in GCS; the initiating browser receives only an opaque cookie. Pending records are consumed with a generation precondition. Sessions use AES-256-GCM and Secure/HttpOnly/SameSite cookies. Mutations check the exact origin and a custom request header. Proxy credentials remain on the backend. The authenticated token-exchange endpoint is the source of Google identity, not browser claims.

Run `npm test` (16 checks, including real HTTP routes with simulated proxy, GCS, and SSH). These use a simulated proxy and record store; they do not establish that production client registration, Google sign-in, GCS permissions, or the VPN tunnel works. A real deployment/sign-in test remains required.

The old custom desktop installer relied on API-key access and is incompatible with owner-only web sessions. Use official WireGuard clients and configurations from this portal for now. Mobile links point to official stores. Installer redesign and mainland connectivity testing remain separate work.

## State migration and deployment

### Guided device setup

The dashboard now offers a device type selector, file/QR instructions and a per-device connection check. Creation checks the running server identity, forwarding and startup enablement before allocating an address. `SERVER_ENDPOINT` must match `GCE_HOST` (the VPN VM address, not the Cloud Run dashboard). Profiles use /32 device addresses, MTU 1380 and full-tunnel routes. IPv6 is routed into the tunnel to prevent bypass; IPv6 internet forwarding is not provisioned by this change.

Before creating devices on an existing installation, the owner clicks **Import existing devices**. This adopts public keys and /32 addresses without needing client private keys. Existing imported devices retain their original profiles; their private keys cannot be recovered from the server, so re-download is unavailable. Newly created dashboard profiles have downloads and QR codes. Previously managed keys removed from records are not re-imported. A synchronization guard refuses to erase unknown manual peers or replace a running server with a different identity.

After importing, create a Windows profile, download/import/activate it, and use **Check connection**. A recent handshake proves peer contact, not browsing or DNS; verify a website on the device. Repeat with a phone QR profile. No SSH commands are required for routine device provisioning after deployment is configured. The current changes are tested locally with mocked cloud/SSH services; live deployment, OAuth secret setup, and end-to-end device verification remain required.

The first read imports the existing `peers.json` into `vpn-state.json` without removing the old file. Thereafter `vpn-state.json` is authoritative for users, hashed invitations and peers. GCS generation preconditions prevent concurrent invitation redemption or device updates from overwriting one another. Back up both files before deployment. Do not roll back to the old application with its stale `peers.json`: that could restore revoked devices. An intentional rollback must first export the current authoritative peer list.

The VM now needs `bash`, `flock`, `base64`, `wg`, and `wg-quick`, plus the existing sudo permission. Synchronization uses a root lock and GCS-generation marker to prevent an older concurrent update from restoring disabled devices. An unsuccessful SSH command is reported as a failed synchronization. No live cloud deployment or real VPN connection has been performed by these tests.

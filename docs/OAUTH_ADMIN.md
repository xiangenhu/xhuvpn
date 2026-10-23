# Owner-only administration through SKO

Only the verified identity `xiangenhu@gmail.com` can administer this VPN manager, through Google OAuth or the proxy's existing verified email/password account.
The restriction is hard-coded and enforced server-side on every admin route; invitation codes cannot grant administrator access.
There is no API-key or browser bearer-token fallback. Email/password authentication is performed by the fixed SKO proxy; the VPN app does not maintain passwords.

## Existing SKO email accounts and SMTP

The login page offers **Sign in with email**, using `POST https://oauth.skoonline.org/user/login` from the VPN backend. It requires a successful proxy response containing a nonempty token, the exact requested email and an explicit true verification assertion (`emailVerified`, `email_verified`, or `verified`), with no false assertion. Passwords and proxy tokens are not persisted or returned to the browser. The app issues its encrypted, eight-hour session as usual. Five attempts per email per 15-minute window are enforced using atomic GCS creates across instances.

After verified email login, a new user receives a restricted pending session. It permits only account status, requesting approval, and redeeming an administrator-issued invitation code. It cannot list, create, download or operate VPN devices. **Request code from administrator** adds the request to the admin dashboard and attempts a fixed-recipient email to `xiangenhu@gmail.com`; repeat notifications are limited to once per day. An uncertain email outcome does not erase the dashboard request or trigger automatic retries.

The administrator selects **Prepare invitation**, reviews the address and generates the code, optionally delivering it through SMTP. Codes remain email-bound, single-use and valid for seven days; issuing invitations reserves capacity within the nine-member limit. Entering the code upgrades the current session and opens device setup immediately. Approved accounts skip approval on later sign-ins. Disabled accounts remain blocked. Existing Google and email sessions for the same verified address use the same VPN role and devices. Only `xiangenhu@gmail.com` is admin through either method; this does not confer administration of the SKO proxy itself. Uninvited Google-only users still need an invitation unless their VPN account already exists.

Approval unlocks browser setup, not a local VPN connection. Users import their profile once and activate the tunnel in WireGuard. The website cannot silently start an installed WireGuard client.

The built-in VPN handshake includes SMTP with a 20-message hourly quota. For a separately registered client, enable `smtp` in proxy Administration. The backend uses the same `PROXY_CLIENT_ID` / `PROXY_CLIENT_SECRET` with the documented `/genai/services/smtp/send` endpoint. Selecting **Also email this invitation through SKO** explicitly sends the generated invitation to that recipient. A stable request ID accompanies the send. Unconfirmed delivery is displayed without automatic retries; the invitation remains available to copy. No test email is sent by loading the page.

These changes have mocked authentication/mail coverage, not live account verification or delivery confirmation. Deployment must verify the actual proxy response includes explicit email verification, configure the client's SMTP permission and secrets, and test sign-in with the account owner. Never weaken verification to compensate for missing gateway assertions.

## Invite friends and disable users

- Sign in as the owner. In **Friends and invitations**, enter the friend's Google email and choose **Generate invitation**.
- Copy the private invitation URL or code. Codes are displayed only at creation, stored as SHA-256 hashes, single-use and expire after seven days. Reissuing an invitation invalidates that email's previous code. URLs keep the code in their fragment; redemption sends it in a POST body, not a URL query.
- The friend opens the link (or pastes the code), then signs in through SKO with the matching Google email. A different email cannot redeem it. Thereafter the active friend can sign in normally without reusing the code.
- Members can manage only their own devices, with three devices per member. The owner can manage all devices. There are at most nine active/pending friends plus the owner.
- **Disable** cancels outstanding invitations, invalidates that user's portal access on their next request, and removes all their device keys from the desired VPN configuration. It then synchronizes the VM. If this fails, the dashboard explicitly warns that existing tunnels may still work; use **Retry VPN synchronization** until it succeeds. The sole administrator cannot be disabled. Disabled users cannot redeem or receive new invitations; re-enabling is not offered in this version.
- On phones/tablets use the official WireGuard client and QR code; on desktops import the configuration. Treat configurations as credentials and share them privately.

Google sign-in, invitation delivery and VPN connectivity are separate. The portal still uses WireGuard: these changes do not establish reliable mainland connectivity or replace target-device testing.

## Activate

### Email sign-in without client registration

Existing verified SKO email/password accounts use the fixed gateway `/user/login`
directly. They need only `APP_URL=https://vpn.skoonline.org` and a private
`SESSION_ENCRYPTION_KEY` (32 random bytes encoded as 64 hex characters) on the
VPN service, plus working GCS access. Google client credentials are not required
for email authentication. SMTP notification delivery still requires credentials;
the administrator dashboard retains access requests even if notification fails.
New email accounts enter the invitation approval screen, not the device dashboard.

If `/api/auth/config` reports `emailLogin:false`, VPN deployment configuration is
incomplete; that response does not mean the submitted account or password is wrong.
After configuring deployment, confirm `emailLogin:true` and test sign-in.

### Google sign-in and SMTP

1. For `https://vpn.skoonline.org`, no proxy admin-page registration is required after deploying the built-in VPN support from `xiangenhu/hulogingatway`. Generate a private 32-byte random hex credential (`openssl rand -hex 32`) and store it in Secret Manager. Mount the same value as `XHUVPN_CLIENT_SECRET` on the OAuth gateway and `PROXY_CLIENT_SECRET` on the VPN service. Never commit or expose the value. The gateway trusts only `https://vpn.skoonline.org/api/auth/oauth/callback`; it grants OAuth and SMTP (20 messages/hour), with no GenAI access. Missing or malformed gateway credentials disable this built-in integration. Existing explicit `xhuvpn` registrations take precedence, including their disabled status and rotated secrets. If one already exists, use its credentials or deliberately remove it before activating the built-in integration.
   For a different VPN portal hostname, use normal client registration and register its exact callback instead. No wildcard subdomain trust is provided.
2. Configure `APP_URL` as that HTTPS portal origin (no path or trailing slash), and `PROXY_CLIENT_ID=xhuvpn`.
3. Store the shared credential (or proxy-generated secret for a registered client) in Secret Manager; mount it as `PROXY_CLIENT_SECRET`. Generate a separate 32-byte random hex value (`openssl rand -hex 32`), store it securely, and mount it as `SESSION_ENCRYPTION_KEY`. Never put either secret in Git or the browser.
4. Keep the configured GCS bucket private. Its existing service account needs object read/create/delete permissions for `auth/`. Configure a lifecycle deletion rule scoped ONLY to prefix `auth/` to remove records older than one day. Do not apply this rule to peers or server keys. Application expiry is enforced independently.
5. Deploy and sign in using the owner's Google account. Verify an uninvited account is denied, then invite a friend and confirm they cannot access administration. Verify device creation/config download/removal against the actual VM.

Example addition to your existing deployment (replace names with your actual secrets):

```sh
gcloud run services update vpn-manager --region us-central1 \
  --update-env-vars APP_URL=https://YOUR_VPN_PORTAL,PROXY_CLIENT_ID=xhuvpn \
  --update-secrets PROXY_CLIENT_SECRET=xhuvpn-proxy-secret:latest,SESSION_ENCRYPTION_KEY=xhuvpn-session-key:latest
```

Grant the runtime service account access to these secrets first. New secret versions require a new Cloud Run revision. Rotating the session key invalidates existing logins. Rotating the built-in credential requires updating both services and redeploying them; removing `XHUVPN_CLIENT_SECRET` from the gateway disables new built-in handshakes. Rotating a registered proxy client secret requires updating its Secret Manager value and redeploying; existing app sessions last up to eight hours, so rotate the session key too to invalidate them immediately.

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

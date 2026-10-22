# Owner-only administration through SKO

Only the Google identity `xiangenhu@gmail.com` can sign in to this VPN manager.
The restriction is enforced server-side on login and every authenticated request.
There is no API-key, email/password, public registration, or bearer-token fallback.
Friends receive individual WireGuard configurations/QR codes from the owner; they cannot log in here.
This changes portal access, not the underlying VPN protocol or its mainland connectivity.

## Activate

1. In https://oauth.skoonline.org/genai/#administration, register client `xhuvpn`, enable OAuth, and register the exact callback `https://YOUR_VPN_PORTAL/api/auth/oauth/callback`.
2. Configure `APP_URL` as that HTTPS portal origin (no path or trailing slash), and `PROXY_CLIENT_ID=xhuvpn`.
3. Store the proxy-generated client secret in Secret Manager; mount it as `PROXY_CLIENT_SECRET`. Generate a separate 32-byte random hex value (`openssl rand -hex 32`), store it securely, and mount it as `SESSION_ENCRYPTION_KEY`. Never put either secret in Git or the browser.
4. Keep the configured GCS bucket private. Its existing service account needs object read/create/delete permissions for `auth/`. Configure a lifecycle deletion rule scoped ONLY to prefix `auth/` to remove records older than one day. Do not apply this rule to peers or server keys. Application expiry is enforced independently.
5. Deploy and sign in using the owner's Google account. Verify another Google account is denied. Verify device creation/config download/removal against the actual VM.

Example addition to your existing deployment (replace names with your actual secrets):

```sh
gcloud run services update vpn-manager --region us-central1 \
  --update-env-vars APP_URL=https://YOUR_VPN_PORTAL,PROXY_CLIENT_ID=xhuvpn \
  --update-secrets PROXY_CLIENT_SECRET=xhuvpn-proxy-secret:latest,SESSION_ENCRYPTION_KEY=xhuvpn-session-key:latest
```

Grant the runtime service account access to these secrets first. New secret versions require a new Cloud Run revision. Rotating the session key invalidates existing logins. Rotating the proxy client secret requires updating its Secret Manager value and redeploying; existing app sessions last up to eight hours, so rotate the session key too to invalidate them immediately.

## Implementation and checks

Uses the proxy's documented `/genai/services/oauth/start` and `/token` contract from https://oauth.skoonline.org/generalInstruction, retrieved 2026-10-22. PKCE and state are encrypted in GCS; the initiating browser receives only an opaque cookie. Pending records are consumed with a generation precondition. Sessions use AES-256-GCM and Secure/HttpOnly/SameSite cookies. Mutations check the exact origin and a custom request header. Proxy credentials remain on the backend. The authenticated token-exchange endpoint is the source of Google identity, not browser claims.

Run `node --test test/oauth.test.js`. These use a simulated proxy and record store; they do not establish that production client registration, Google sign-in, GCS permissions, or the VPN tunnel works. A real deployment/sign-in test remains required.

The old custom desktop installer relied on API-key access and is incompatible with owner-only web sessions. Use official WireGuard clients and configurations from this portal for now. Mobile links point to official stores. Installer redesign and mainland connectivity testing remain separate work.

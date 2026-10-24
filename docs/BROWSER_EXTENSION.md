# Browser extension connection

This adds a browser proxy alongside WireGuard and the optional Kasm remote browser.
Kasm is not required. Cloud Run serves accounts and short-lived credentials; a
separate HTTPS forward-proxy listener runs on the VPN VM or an isolated proxy VM.
Cloud Run itself does not terminate CONNECT tunnels.

## User flow

1. Install the extension once, then pin Research Network to its toolbar.
2. Click Sign in & connect. Sign in on the portal tab it opens.
3. An approved account with current research-use consent connects automatically.
   No code comparison, separate browser-approval button or WireGuard file is needed.
   Unapproved accounts remain in the portal request-access flow.
4. Use Disconnect in the extension when finished. Sessions expire after eight hours;
   portal logout alone does not disconnect an approved extension.

A portal-only isolated content script obtains the pending PKCE proof exclusively
from the background controller in the exact top-level tab opened by this extension.
It completes the same-origin authenticated approval, then tells the background to
exchange the one-use grant and apply proxy settings. The page never receives the
verifier through its DOM, URL or page messages. Other tabs, frames, sites and
external senders cannot obtain the proof. Membership, consent and gateway checks
remain enforced. The older explicit pairing endpoints remain for compatibility.

## Browser coverage and distribution

| Browser | Package | Distribution status |
| --- | --- | --- |
| Chrome desktop 120+ | Chromium MV3 | Load unpacked for preview; store submission pending |
| Edge desktop | Chromium MV3 | Load unpacked for preview; store submission pending |
| Brave desktop | Chromium MV3 | Load unpacked for preview; browser verification pending |
| Opera desktop | Chromium MV3 | Load unpacked for preview; browser verification pending |
| Firefox desktop 128+ | Firefox MV3 | Temporary add-on for preview; Mozilla signing pending |
| Safari, iPhone/iPad, Android browsers | No extension in this release | Use WireGuard |

Firefox uses an event-page background and `proxy.onRequest`; Chromium uses a
service worker and `chrome.proxy.settings`. The auth listeners use each browser's
supported API. These are implemented targets, not a claim of live verification in
every browser. Packages are built by `npm run build:extensions` and included in
the Cloud Run image at `/downloads/research-network-{chromium,firefox}.zip`.
User instructions are at `/extension-setup.html`. Never insert secrets in the ZIP.

Permanent, one-click user installation still needs browser-store publication.
Submit the Chromium package to Chrome Web Store/Edge Add-ons, and the Firefox
package to Mozilla for signing. Supply accurate privacy disclosures, screenshots,
publisher identity and current store-specific data collection declarations before
submission. This work does not create publisher accounts or accept store terms.

## One-time administrator deployment

1. Choose a DNS name such as `proxy.skoonline.org` pointing to the VM's external
   IP. Obtain a publicly trusted certificate for that name. Allow inbound TCP
   8443 (or the chosen port). Keep SSH limited to administrators. Installing the
   extension does not create this DNS record, VM or firewall rule.
2. Create a new independent random gateway secret using `openssl rand -hex 32`.
   Store it privately; do not reuse the OAuth client secret or WireGuard keys.
3. On the Linux proxy VM, install Docker, check out this repository, then run:

   ```bash
   sudo bash deploy-extension-proxy.sh proxy.skoonline.org /path/fullchain.pem /path/privkey.pem
   ```

   Paste only the gateway secret at the hidden prompt. The script verifies the
   certificate host/key, copies certificates with restricted access, builds the
   proxy and runs it with a read-only filesystem, dropped capabilities, resource
   limits and no Cloud Run/GCS/SSH credentials. It replaces only the existing
   `xhuvpn-extension-proxy` container. It does not change WireGuard configuration.
   Use a host without unrelated sensitive services when possible.
4. From Google Cloud Shell in this repository, run:

   ```bash
   bash setup-extension-cloudrun.sh socraticplayground vpn-manager https://proxy.skoonline.org:8443
   ```

   Paste the same gateway secret at its hidden prompt. The script discovers the
   region, stores the value in Secret Manager, grants the runtime identity access
   to that secret only, and pins a secret version on the Cloud Run revision.
   Existing OAuth, session and WireGuard settings are preserved. The required
   runtime values are `EXTENSION_PROXY_ORIGIN` and `EXTENSION_GATEWAY_SECRET`.
5. After certificate renewal, rerun the proxy installer with the renewed files
   and same gateway secret; it copies the new files and restarts the listener.
   Rotate the shared secret on both deployments together. If rotating after an
   incident, revoke existing extension sessions in the portal too.

## Access and network boundaries

- Pairing requests expire after ten minutes. The extension holds a random device
  code and PKCE verifier; only a matching verifier can exchange an approved code.
  The new sign-in flow completes automatically only with the local verifier, verified login, membership and current consent; the older code approval flow remains compatible.
  Anonymous starts are rate-limited and pending records bounded. Polling is a
  read until an atomic single-use exchange creates the session.
- Proxy credentials are random, per connection and eight-hour limited. Only
  hashes persist in private GCS state. No app client secret, gateway credential,
  portal cookie or Google token is shipped to the extension. Each user can have
  three active connections and revoke them in the portal.
- The extension keeps its short-lived connection credentials in extension-local
  storage (not sync) to survive background restarts. It supplies them only for
  proxy challenges from the configured exact host/port and cancels repeat failures.
  Ordinary website auth and unrelated proxy challenges never receive them.
- The HTTPS gateway authenticates before DNS or connections. It checks the
  portal on each new request and every 30 seconds for established tunnels. Disabled
  users, revoked sessions, changed consent, expired credentials and portal errors
  close/fail requests. Revocation of an established tunnel can take 30 seconds
  plus the seven-second control-request timeout.
- Only HTTP port 80 and HTTPS CONNECT port 443 are forwarded. DNS results must
  all be public unicast; the chosen address is pinned, blocking private ranges,
  loopback, link-local, metadata and DNS-rebinding access. The portal and proxy
  hostnames are excluded as destinations. No destination URLs/bodies are logged.
- The proxy can see HTTP content and HTTPS destination names. HTTPS site traffic
  remains end-to-end encrypted inside CONNECT; no certificate interception is
  performed. This is a browser web proxy, not a whole-device VPN or an anonymity
  guarantee. Other apps, private windows, browser-internal and non-web traffic
  are outside its scope. Firefox WebRTC is disabled while connected; Chromium
  disables non-proxied WebRTC UDP. Settings owned by the extension are cleared
  on Disconnect, restoring prior user/browser settings.
- Portal/proxy management traffic is deliberately direct so Disconnect/sign-in
  remain reachable if the gateway is down. Other web traffic does not receive an
  automatic direct fallback; the user explicitly disconnects to restore normal
  browsing. Another extension or enterprise proxy policy can prevent activation.

## Verification and remaining acceptance checks

Run `npm test`, `npm --prefix proxy ci`, `npm run test:proxy`, and
`npm run build:extensions`. Tests cover pairing approval, PKCE, consent, account
revocation, expiry, quotas, safe auth challenges, SSRF/DNS pinning, request denial
and closing established tunnels. Extension controller tests simulate browser APIs.
They do not substitute for running each supported browser with the live proxy.

Before release, install preview packages on the target browsers, approve a test
user, compare the browser's observed egress address to the VM, test HTTP/HTTPS and
WebSockets, restart the browser, revoke access during a live download, expire a
session, disconnect with the portal offline, and test a competing proxy extension.
Verify DNS/TLS, firewall, resource usage and certificate renewal. Verify store
signing/install/update flows. Mainland/Hong Kong network reachability has not
been established by these tests.

Implementation references checked 2026-10-24: Chrome `proxy` and `webRequest`
API docs; Mozilla `proxy.onRequest`, `webRequest.onAuthRequired`, `background`,
and `privacy.network` docs. Browser-specific manifest/signing policies may change.

## Website installation entry point

The portal can provide the installation page and links. Chrome on ordinary Windows
and macOS installations requires Chrome Web Store distribution (enterprise policies
are a separate managed-device path). Firefox can install a Mozilla-signed unlisted
XPI hosted on this website. Edge can use Edge Add-ons distribution. Do not present
manual preview ZIPs as a normal colleague installation experience. Installation
always uses the browser's confirmation. No signed package or store listing has
been published by this implementation.

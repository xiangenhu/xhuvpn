# Browser-only research access

Approved users can choose WireGuard or a remote browser from the dashboard. The browser mode uses Kasm Workspaces' documented public developer API. It is not an HTTP rewriting proxy and does not affect ordinary browser tabs or other applications. WireGuard remains independently controlled on the user's device.

Browser-only is the default for a new browser; an explicitly saved WireGuard preference is retained. After approval and research-use consent, sign-in automatically starts or reopens the research browser when the service is configured. Returning with the existing eight-hour authenticated cookie avoids another sign-in. This is session restoration, not authentication based on an IP address or a WireGuard handshake.

**Turn off & sign out** requests remote-session destruction and then revokes the current portal login. Ordinary Logout also requests browser cleanup when enabled. If cleanup fails, the portal retains login so the user can retry. Accepted shutdown can still take time on the browser server. Closing the tab, session idle expiry, and the local WireGuard switch do not automatically revoke the portal cookie; those events are not equivalent to this explicit off action. A new device or expired login still requires authentication, even when WireGuard is on.

## Deployment required

Provision an isolated Kasm browser service with a valid HTTPS origin, a browser workspace image and a server-side API key with the documented User and Users Auth Session permissions. Configure:

- `BROWSER_ORIGIN`: HTTPS origin, e.g. `https://browser.skoonline.org` (must actually be deployed).
- `BROWSER_IMAGE_ID`: approved browser workspace image ID.
- `BROWSER_API_KEY` and `BROWSER_API_SECRET`: store as Cloud Run secrets.

Configure embedding to allow only the VPN portal origin and compatible cookie settings. Disable sharing, persistent browser profiles, access to cloud metadata and internal infrastructure. Set finite session duration and idle expiry in Kasm to bound costs and abandoned sessions. Allocate a separate browser host or appropriately isolated network; do not run untrusted browsing with access to VPN keys or cloud credentials. Decide host size and concurrency before provisioning; this code does not purchase infrastructure or configure these controls.

Each start requests a new anonymous Kasm identity with sharing disabled. Only session/user IDs are saved, indexed by the authenticated VPN account. Launch URLs and API secrets are not persisted in the state document. Status supplies the link only to the owner after approval and consent checks. Session links are credentials; do not distribute them. Invalid origins are rejected. The API secret stays on the server.

The dashboard does not claim shutdown is complete until status reports an invalid session ID. Disable attempts both browser shutdown and WireGuard synchronization; failures remain visible and can be retried with **Retry connection cleanup**. Ambiguous creates retain a reservation to prevent duplicate allocations. The administrator must reconcile such a reservation with the Kasm session list before removing it from `browserSessions` in the private state document. Never blindly clear it and create another session.

## Research-use agreement

The portal displays the notice at sign-in and in its controls. Approved users must explicitly accept version `2026-10-23` before profile creation/download or browser start/open. Acceptance time/version are recorded privately. This is a use policy and acknowledgement, not a claim that the operator is exempt from legal responsibility.

## Live acceptance checks

After deployment: verify that pending users cannot launch sessions; accept the notice; start and view a browser on desktop and mobile; confirm two users receive isolated sessions; end and verify destruction; disable a user with an active session and verify termination; confirm session duration/idle limits and blocked metadata/internal-network access. Test on the intended mainland/Hong Kong networks. Browser streaming availability and performance are not established by mocked API tests.

API reference: https://docs.kasm.com/docs/latest/reference/developer-api

# Colleague setup workflow review

Reviewed 24 October 2026. Audience: approved colleagues with no technical background.
This is a review of the implemented interface and automated behavior, not a completed
usability study or proof that the production VPN is working.

## Intended journey

1. Sign in with an existing verified account. A new colleague requests access;
   approval remains a one-time administrator responsibility.
2. Accept the research-use agreement. Open My VPN, which is also the owner's
   default view. Administration is a separate owner-only section.
3. Open WireGuard. If already installed, use “WireGuard is open — continue”.
   Otherwise follow the official installation link and return to this page.
4. Keep the suggested device name and choose “Prepare my configuration file”.
   Device type and name changes are optional, under an expandable section.
5. On success, the page shows the exact filename and an explicit download button.
   Save that file, import it into WireGuard and activate the connection. Desktop
   setup stays inline rather than opening an additional success window. Mobile
   setup also offers the QR/import window.
6. Check for a server handshake. This does not certify that browsing works;
   confirm by opening a website on the connected device.
7. On later visits, use My saved configurations to download an existing file.
   Reconnecting in WireGuard does not require creating another registration.

## Review findings and changes

| Finding | Resulting interface behavior |
| --- | --- |
| Owner setup and administration mixed together | Separate My VPN and Administration; personal list contains only the signed-in account's devices |
| Unavailable services presented as recommended | WireGuard is the default; unavailable services are disabled; alternatives are expandable |
| Extension installation needs developer mode or temporary add-ons | Clearly labeled testing preview, intended for assisted testing, not advertised as a simple colleague installation |
| Device naming looks like a prerequisite | Suggested name retained; optional edits collapsed |
| Installing WireGuard mistaken for obtaining its profile | Explicitly explain that this website creates the configuration file |
| Download assumed rather than observed | Explicit filename and download link; no claim that an automatic download succeeded |
| Modal adds another place to look | Desktop creation shows the download and import instructions inline; saved-profile help can still open a window |
| Users lose their next step | Persistent numbered instructions and “cannot find file” help |
| Generic errors leave users clicking repeatedly | Explain when a file is not ready, preserve the error and provide contact/help; check saved registrations before retrying |
| Server health mistaken for a personal connection | Header says server availability; per-device check reports handshake separately |
| Duplicate installer cards dominate the page | Additional platform downloads are expandable |

## Release blockers and acceptance checks

- Production profile creation has failed in the user's screenshots. The failure
  reason must be reproduced and resolved; UI changes do not resolve this blocker.
- The extension still requires deployed HTTPS proxy infrastructure, live browser
  testing and signed/store distribution before it is suitable for unassisted use.
- Verify a first-time colleague can sign in, obtain the actual conf attachment,
  locate it in Downloads, import it and browse after activation on Windows and Mac.
  Also verify mobile file import and QR scanning on another screen.
- Verify returning users can find a saved file without creating duplicates.
- Exercise a slow response, server failure, account revocation, unavailable browser
  service and lost download. Each must show a clear current state and next action.
- Observe a nontechnical colleague completing the process without coaching. Record
  where they hesitate. Automated tests cannot establish ease of use.

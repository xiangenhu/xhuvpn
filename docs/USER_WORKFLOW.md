# Current user workflow: WireGuard only

Updated 24 October 2026 following the owner's successful WireGuard test.

1. Sign in with Google or a verified SKO email account.
2. See VPN access granted or not yet granted. A not-granted user requests a code
   from xiangenhu@gmail.com, then enters the emailed code to continue.
3. Accept the research-use agreement if shown.
4. Open WireGuard. Use the official installation link if needed.
5. Return to the website and choose WireGuard is open — continue, then Prepare my
   configuration file. No connection-method selection or naming is required.
6. Download the .conf file, import it into WireGuard and choose Activate.
7. For later use, activate the saved connection in WireGuard. To stop, choose
   Deactivate. Website sign-out does not stop WireGuard.

Administrator approval emails are sent by default and contain the approved email,
access code, expiry, sign-in link, installer link, file download/import/activation
instructions, missing-download help, privacy guidance and the support address.
The administrator can explicitly opt out of sending. Mail-service acceptance is
reported separately from an unconfirmed send; actual inbox delivery is not proven
by automated tests.

The user-facing browser extension and remote-browser flows are removed. The former
extension download page explains the change and links back to WireGuard setup.
Technical connection records remain in Administration. Personal saved-file history
contains configuration download/help rather than device-management controls.

## Acceptance checks

- An unapproved account can request a code but cannot download VPN credentials.
- A granted account reaches WireGuard setup without a connection selector.
- The approval email contains complete WireGuard steps and no extension prompts.
- The named .conf attachment can be downloaded and imported, and browsing works
  after activation. The owner has reported WireGuard working; automated tests
  cannot establish all colleagues' operating systems or actual email delivery.
- A returning user can retrieve a saved file without creating another registration.
- Errors stay visible and do not pretend a file exists or a connection is active.
- Observe a nontechnical colleague completing setup without coaching.

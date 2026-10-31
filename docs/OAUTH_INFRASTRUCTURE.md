# Optional OAuth-managed GCS and xAPI LRS settings

Both switches default to **false**. Preserve the app's own values as fallback.

```dotenv
USE_OAUTH_GCS=false
USE_OAUTH_LRS=false
OAUTH_BASE_URL=https://oauth.skoonline.org
PROXY_CLIENT_ID=<this-app-registration-id>
PROXY_CLIENT_SECRET=<server-secret>
```

Register optional storage and the primary, debug and webhooks LRS profiles in oauth.skoonline.org. Each LRS uses URL, User, Secret / Password. Enable either switch independently on the consuming app and restart/redeploy it.

| Switch | true | false or unset |
| --- | --- | --- |
| USE_OAUTH_GCS | Registered bucket first; own bucket fallback | Own bucket |
| USE_OAUTH_LRS | Registered profiles first; own complete profiles fallback | Own LRS profiles |

The startup preloader runs before storage/configuration modules, calls POST /genai/services/config with existing app client credentials, and retrieves only the enabled settings. Both off makes no request. Native variable aliases are mapped server-side; no secrets are sent to browsers. Existing app identifiers, bucket prefixes, service-account/project credentials, event producers and retry behavior are preserved. Primary maps to learning LRS/XAPI variables, debug to BUG_LRS, and webhooks to WORKBUDDY_LRS; canonical profile aliases are also available. Channels without an existing producer do not begin sending events simply because credentials are present.

Missing or partial gateway profiles retain the original settings as a complete set. Network errors, HTTP 429 and 5xx retain originals. Wrong credentials or a wrong-app response fail startup clearly. Registered profiles replace URL and authentication together; a gateway URL never inherits the original password/token/header. Existing bearer tokens are cleared only for a selected complete Basic-auth profile.

The source update does not change live Cloud Run variables, registration values or secrets. Production still needs the consuming app service account to have access to the selected private bucket. Changing a bucket does not migrate existing data. This implements startup configuration fallback, not per-operation storage failover or automatic cross-LRS duplication. Registration edits take effect on the next app startup.

Supported npm server commands and Docker startup include the preloader. For custom direct launches add `node --import ./oauth-infrastructure.mjs <entrypoint>` using a path relative to the launch directory. Existing apps with legacy login-only registrations must supply a unified app registration's client ID/secret before enabling either infrastructure switch. The flags remain false without these credentials.

Run `npm run test:oauth-infrastructure` for dependency-free checks of defaults, four switch combinations, native mapping, separate profiles, partial settings, outages and credential isolation. Live GCS/LRS verification must be performed explicitly with synthetic data after deployment.

#!/usr/bin/env bash
# Run in Google Cloud Shell. Never run with shell tracing or paste secrets in commands.
set +x
set -euo pipefail
TASK_PROJECT="${1:-socraticplayground}"
TASK_SERVICE="${2:-vpn-manager}"
PROXY_SECRET=xhuvpn-proxy-secret
SESSION_SECRET=xhuvpn-session-key

# Discover the service's actual region instead of assuming the deployment default.
TASK_REGION=$(gcloud run services list --project="$TASK_PROJECT" --format=json |
  python3 -c 'import json,sys
rows=[x for x in json.load(sys.stdin) if x.get("metadata",{}).get("name")==sys.argv[1]]
if len(rows)!=1: sys.exit("Expected exactly one matching Cloud Run service; check the service name.")
region=rows[0].get("metadata",{}).get("labels",{}).get("cloud.googleapis.com/location")
if not region: sys.exit("Could not determine service region.")
print(region)' "$TASK_SERVICE")
TASK_IDENTITY=$(gcloud run services describe "$TASK_SERVICE" --project="$TASK_PROJECT" --region="$TASK_REGION" --format='value(spec.template.spec.serviceAccountName)')
[[ -n "$TASK_IDENTITY" ]] || { echo 'Runtime service account not found.' >&2; exit 1; }
SESSION_CONFIGURED=$(gcloud run services describe "$TASK_SERVICE" --project="$TASK_PROJECT" --region="$TASK_REGION" --format=json |
  python3 -c 'import json,sys,re
env=json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env",[])
entry=next((x for x in env if x["name"]=="SESSION_ENCRYPTION_KEY"),{})
if "value" in entry and entry["value"] and not re.fullmatch("[a-fA-F0-9]{64}",entry["value"]): sys.exit("Existing session key is malformed; inspect its configuration before continuing.")
print("yes" if entry.get("valueFrom") or entry.get("value") else "no")')

printf 'Configure authentication for %s / %s / %s\n' "$TASK_PROJECT" "$TASK_SERVICE" "$TASK_REGION"
printf 'Runtime identity: %s\n' "$TASK_IDENTITY"
read -r -p 'Continue? [y/N] ' TASK_CONFIRM
[[ "$TASK_CONFIRM" == y || "$TASK_CONFIRM" == Y ]] || exit 0
read -r -s -p 'Paste only the xhuvpn client secret (input hidden): ' TASK_PROXY_VALUE
printf '\n'
[[ "$TASK_PROXY_VALUE" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || { echo 'Expected the client secret alone, not the whole backend settings block.' >&2; exit 1; }
trap 'unset TASK_PROXY_VALUE' EXIT

if gcloud secrets describe "$PROXY_SECRET" --project="$TASK_PROJECT" >/dev/null 2>&1; then
  TASK_PROXY_VERSION=$(printf '%s' "$TASK_PROXY_VALUE" | gcloud secrets versions add "$PROXY_SECRET" --project="$TASK_PROJECT" --data-file=- --format='value(name)')
else
  printf '%s' "$TASK_PROXY_VALUE" | gcloud secrets create "$PROXY_SECRET" --project="$TASK_PROJECT" --replication-policy=automatic --data-file=- >/dev/null
  TASK_PROXY_VERSION=$(gcloud secrets versions describe latest --secret="$PROXY_SECRET" --project="$TASK_PROJECT" --format='value(name)')
fi
unset TASK_PROXY_VALUE
TASK_MOUNTS="PROXY_CLIENT_SECRET=$PROXY_SECRET:${TASK_PROXY_VERSION##*/}"
TASK_SECRETS=("$PROXY_SECRET")

# Preserve an existing session key to avoid invalidating active sessions.
if [[ "$SESSION_CONFIGURED" == no ]]; then
  if ! gcloud secrets describe "$SESSION_SECRET" --project="$TASK_PROJECT" >/dev/null 2>&1; then
    printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create "$SESSION_SECRET" --project="$TASK_PROJECT" --replication-policy=automatic --data-file=- >/dev/null
  fi
  TASK_SESSION_VERSION=$(gcloud secrets versions describe latest --secret="$SESSION_SECRET" --project="$TASK_PROJECT" --format='value(name)')
  TASK_MOUNTS+=",SESSION_ENCRYPTION_KEY=$SESSION_SECRET:${TASK_SESSION_VERSION##*/}"
  TASK_SECRETS+=("$SESSION_SECRET")
fi
for TASK_SECRET in "${TASK_SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$TASK_SECRET" --project="$TASK_PROJECT" \
    --member="serviceAccount:$TASK_IDENTITY" --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
done
gcloud run services update "$TASK_SERVICE" --project="$TASK_PROJECT" --region="$TASK_REGION" \
  --update-env-vars='APP_URL=https://vpn.skoonline.org,PROXY_CLIENT_ID=xhuvpn' \
  --update-secrets="$TASK_MOUNTS"
echo 'Configuration updated. Check the portal and complete a real sign-in.'
curl --fail --silent --show-error --max-time 30 https://vpn.skoonline.org/api/auth/config
printf '\n'

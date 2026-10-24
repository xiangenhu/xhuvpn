#!/usr/bin/env bash
# Run in Google Cloud Shell. Does not change existing OAuth or WireGuard secrets.
set +x
set -euo pipefail
TASK_PROJECT="${1:-socraticplayground}"
TASK_SERVICE="${2:-vpn-manager}"
TASK_PROXY_ORIGIN="${3:-https://proxy.skoonline.org:8443}"
python3 -c 'import sys,urllib.parse
u=urllib.parse.urlsplit(sys.argv[1])
if u.scheme!="https" or not u.hostname or "." not in u.hostname or u.username or u.password or u.path or u.query or u.fragment: sys.exit("Use an HTTPS origin such as https://proxy.skoonline.org:8443")' "$TASK_PROXY_ORIGIN"
TASK_REGION=$(gcloud run services list --project="$TASK_PROJECT" --format=json | python3 -c 'import json,sys
rows=[x for x in json.load(sys.stdin) if x.get("metadata",{}).get("name")==sys.argv[1]]
if len(rows)!=1: sys.exit("Expected exactly one service; supply the correct Cloud Run service name.")
print(rows[0]["metadata"]["labels"]["cloud.googleapis.com/location"])' "$TASK_SERVICE")
TASK_IDENTITY=$(gcloud run services describe "$TASK_SERVICE" --region="$TASK_REGION" --project="$TASK_PROJECT" --format='value(spec.template.spec.serviceAccountName)')
[[ -n "$TASK_IDENTITY" ]] || exit 1
printf 'Enable extension pairing on %s / %s / %s using %s\n' "$TASK_PROJECT" "$TASK_SERVICE" "$TASK_REGION" "$TASK_PROXY_ORIGIN"
read -r -p 'Continue? [y/N] ' TASK_CONFIRM
[[ "$TASK_CONFIRM" == y || "$TASK_CONFIRM" == Y ]] || exit 0
read -r -s -p 'Paste EXTENSION_GATEWAY_SECRET (64 hex; input hidden): ' TASK_GATEWAY_VALUE
printf '\n'
[[ "$TASK_GATEWAY_VALUE" =~ ^[a-fA-F0-9]{64}$ ]] || { unset TASK_GATEWAY_VALUE;exit 1; }
trap 'unset TASK_GATEWAY_VALUE' EXIT
TASK_SECRET=xhuvpn-extension-gateway-secret
if gcloud secrets describe "$TASK_SECRET" --project="$TASK_PROJECT" >/dev/null 2>&1; then
  TASK_VERSION=$(printf '%s' "$TASK_GATEWAY_VALUE" | gcloud secrets versions add "$TASK_SECRET" --project="$TASK_PROJECT" --data-file=- --format='value(name)')
else
  printf '%s' "$TASK_GATEWAY_VALUE" | gcloud secrets create "$TASK_SECRET" --project="$TASK_PROJECT" --replication-policy=automatic --data-file=- >/dev/null
  TASK_VERSION=$(gcloud secrets versions describe latest --secret="$TASK_SECRET" --project="$TASK_PROJECT" --format='value(name)')
fi
unset TASK_GATEWAY_VALUE
gcloud secrets add-iam-policy-binding "$TASK_SECRET" --project="$TASK_PROJECT" --member="serviceAccount:$TASK_IDENTITY" --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
gcloud run services update "$TASK_SERVICE" --project="$TASK_PROJECT" --region="$TASK_REGION" \
  --update-env-vars="EXTENSION_PROXY_ORIGIN=$TASK_PROXY_ORIGIN" \
  --update-secrets="EXTENSION_GATEWAY_SECRET=$TASK_SECRET:${TASK_VERSION##*/}"
echo 'Extension configuration saved. Connect tests the HTTPS proxy before issuing an approval code.'

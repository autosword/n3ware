#!/usr/bin/env bash
# setup-secrets.sh — Create all n3ware secrets in Google Secret Manager
#
# Usage:
#   bash scripts/setup-secrets.sh <GCP_PROJECT_ID>
#
# Requirements:
#   - gcloud CLI authenticated with a principal that has roles/secretmanager.admin
#   - Secret Manager API enabled: gcloud services enable secretmanager.googleapis.com

set -euo pipefail

PROJECT="${1:-}"
if [[ -z "$PROJECT" ]]; then
  echo "Usage: $0 <GCP_PROJECT_ID>" >&2
  exit 1
fi

SECRETS=(
  jwt-secret
  master-api-key
  stripe-secret-key
  stripe-webhook-secret
  stripe-starter-price-id
  stripe-pro-price-id
  stripe-agency-price-id
  sendgrid-api-key
  postmark-api-key
  cloudflare-api-token
  cloudflare-account-id
  cloudflare-zone-id
  r2-access-key-id
  r2-secret-access-key
  anthropic-api-key
  google-client-id
  google-client-secret
)

echo "Creating secrets in project: ${PROJECT}"
echo "Leave a secret blank to skip it."
echo ""

for SECRET in "${SECRETS[@]}"; do
  read -rsp "  ${SECRET}: " VALUE
  echo ""

  if [[ -z "$VALUE" ]]; then
    echo "  → skipped"
    continue
  fi

  # Create the secret (ignore error if it already exists)
  if ! gcloud secrets describe "${SECRET}" --project="${PROJECT}" &>/dev/null; then
    gcloud secrets create "${SECRET}" \
      --project="${PROJECT}" \
      --replication-policy=automatic \
      --quiet
  fi

  # Add the new version
  echo -n "${VALUE}" | gcloud secrets versions add "${SECRET}" \
    --project="${PROJECT}" \
    --data-file=- \
    --quiet

  echo "  → created/updated"
done

echo ""
echo "=========================================="
echo "Done. Grant Cloud Run access with:"
echo ""
echo "  PROJECT_NUMBER=\$(gcloud projects describe ${PROJECT} --format='value(projectNumber)')"
echo "  SA=\"\${PROJECT_NUMBER}-compute@developer.gserviceaccount.com\""
echo ""
echo "  gcloud projects add-iam-policy-binding ${PROJECT} \\"
echo "    --member=\"serviceAccount:\${SA}\" \\"
echo "    --role=\"roles/secretmanager.secretAccessor\""
echo ""
echo "Or grant per-secret (least privilege):"
echo ""
for SECRET in "${SECRETS[@]}"; do
  echo "  gcloud secrets add-iam-policy-binding ${SECRET} \\"
  echo "    --project=${PROJECT} \\"
  echo "    --member=\"serviceAccount:\${SA}\" \\"
  echo "    --role=\"roles/secretmanager.secretAccessor\""
done
echo "=========================================="

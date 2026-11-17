#!/usr/bin/env bash
# Builds the site and uploads it to the two Azure Static Web Apps behind
# stablehops.com (mainnet) and testnet.stablehops.com (testnet). Both get the
# same build: the hostname decides the network when the page loads.
#
#   scripts/deploy.sh            both sites, testnet first
#   scripts/deploy.sh testnet    only the testnet site
#   scripts/deploy.sh mainnet    only the mainnet site
#
# Needs the Azure CLI, signed in (az login) to the subscription that holds
# the apps. No secret lives in the repo: the upload token is read from Azure
# when the script runs and is never printed.
set -euo pipefail

GROUP="${DEPLOY_RESOURCE_GROUP:-stablehops}"
MAINNET_APP="${DEPLOY_MAINNET_APP:-stablehops}"
TESTNET_APP="${DEPLOY_TESTNET_APP:-stablehops-testnet}"
UPLOADER='@azure/static-web-apps-cli@2.1.0'

cd "$(dirname "$0")/.."

case "${1:-all}" in
    all) targets=(testnet mainnet) ;;
    testnet | mainnet) targets=("$1") ;;
    *)
        echo "usage: scripts/deploy.sh [testnet|mainnet]" >&2
        exit 2
        ;;
esac

# What is live should always be a commit that anyone can read.
if [ -z "${DEPLOY_UNCOMMITTED:-}" ] && ! git diff --quiet HEAD --; then
    echo 'There are uncommitted changes. Commit them first, or set DEPLOY_UNCOMMITTED=1.' >&2
    exit 1
fi

pnpm run build

# Nothing the build writes has a space in its name. A file that does is a
# stray copy made by something else, and it does not belong on the site.
strays=$(find build -name '* *' -print)
if [ -n "$strays" ]; then
    printf 'Unexpected files in build/, not uploading:\n%s\n' "$strays" >&2
    exit 1
fi

for target in "${targets[@]}"; do
    if [ "$target" = mainnet ]; then app="$MAINNET_APP"; else app="$TESTNET_APP"; fi
    echo "Uploading the build to the $target site ($app)"
    token=$(az staticwebapp secrets list --name "$app" --resource-group "$GROUP" \
        --query properties.apiKey --output tsv)
    SWA_CLI_DEPLOYMENT_TOKEN="$token" pnpm dlx "$UPLOADER" deploy ./build --env production
done

echo "Deployed commit $(git rev-parse --short HEAD) to: ${targets[*]}"

#!/usr/bin/env bash
# Builds the site and uploads it to the Azure Static Web Apps behind
# stablehops.com (mainnet), testnet.stablehops.com (testnet) and
# staging.stablehops.com (staging). Every site gets the same kind of build:
# the hostname decides the network when the page loads.
#
#   scripts/deploy.sh            the two real sites, testnet first
#   scripts/deploy.sh testnet    only the testnet site
#   scripts/deploy.sh mainnet    only the mainnet site
#   scripts/deploy.sh staging    the staging site, from the branch checked out
#
# The real sites are only deployed from main. Staging takes any branch: it is
# where work is tried before it is merged.
#
# Needs the Azure CLI, signed in (az login) to the subscription that holds
# the apps. No secret lives in the repo: the upload token is read from Azure
# when the script runs and is never printed.
set -euo pipefail

GROUP="${DEPLOY_RESOURCE_GROUP:-stablehops}"
MAINNET_APP="${DEPLOY_MAINNET_APP:-stablehops}"
TESTNET_APP="${DEPLOY_TESTNET_APP:-stablehops-testnet}"
STAGING_APP="${DEPLOY_STAGING_APP:-stablehops-staging}"
UPLOADER='@azure/static-web-apps-cli@2.1.0'

cd "$(dirname "$0")/.."

case "${1:-all}" in
    all) targets=(testnet mainnet) ;;
    testnet | mainnet | staging) targets=("$1") ;;
    *)
        echo "usage: scripts/deploy.sh [testnet|mainnet|staging]" >&2
        exit 2
        ;;
esac

branch=$(git rev-parse --abbrev-ref HEAD)
for target in "${targets[@]}"; do
    if [ "$target" != staging ] && [ "$branch" != main ] && [ -z "${DEPLOY_ANY_BRANCH:-}" ]; then
        echo "The $target site is deployed from main, and this is $branch." >&2
        echo 'Switch to main, or run: scripts/deploy.sh staging' >&2
        exit 1
    fi
done

# What is live should always be a commit that anyone can read.
if [ -z "${DEPLOY_UNCOMMITTED:-}" ] && ! git diff --quiet HEAD --; then
    echo 'There are uncommitted changes. Commit them first, or set DEPLOY_UNCOMMITTED=1.' >&2
    exit 1
fi

# The build has to be able to read the network it is about to serve: a Stellar
# protocol upgrade can leave the bundled SDK behind. DEPLOY_SKIP_CHECK=1 skips
# this, for the day the check itself is what is broken.
if [ -z "${DEPLOY_SKIP_CHECK:-}" ]; then
    networks=''
    for target in "${targets[@]}"; do
        if [ "$target" = mainnet ]; then networks="$networks mainnet"; else networks="$networks testnet"; fi
    done
    for network in $(printf '%s\n' $networks | sort -u); do
        pnpm exec tsx scripts/check-stellar.ts "--$network"
    done
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
    case "$target" in
        mainnet) app="$MAINNET_APP" ;;
        testnet) app="$TESTNET_APP" ;;
        staging) app="$STAGING_APP" ;;
    esac
    echo "Uploading the build to the $target site ($app)"
    token=$(az staticwebapp secrets list --name "$app" --resource-group "$GROUP" \
        --query properties.apiKey --output tsv)
    SWA_CLI_DEPLOYMENT_TOKEN="$token" pnpm dlx "$UPLOADER" deploy ./build --env production
done

echo "Deployed commit $(git rev-parse --short HEAD) from $branch to: ${targets[*]}"

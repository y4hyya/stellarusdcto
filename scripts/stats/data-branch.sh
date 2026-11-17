#!/usr/bin/env bash
# Opens and saves the branch the usage stats are published on.
#
#   data-branch.sh open <dir>   check the stats branch out into <dir>, creating
#                               it empty the first time
#   data-branch.sh save <dir>   commit and push <dir> if anything changed
#
# The data lives on its own branch so the main branch history stays about the
# code. Used by .github/workflows/usage-stats.yml.
#
# The remote is never guessed outside CI. In a GitHub Actions checkout
# `origin` is this repository. In a local clone it may be somebody else's (in
# the owner's checkout it is the upstream project), so by hand the remote has
# to be named: STATS_REMOTE=<remote> data-branch.sh ...
set -euo pipefail

BRANCH="${STATS_BRANCH:-stats}"
if [ -n "${STATS_REMOTE:-}" ]; then
    REMOTE="$STATS_REMOTE"
elif [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    REMOTE="origin"
else
    echo "data-branch.sh: set STATS_REMOTE to the remote that holds the stats branch." >&2
    echo "It is not guessed outside CI, because origin may be another project's repository." >&2
    exit 2
fi

usage() {
    echo "usage: data-branch.sh open|save <dir>" >&2
    exit 2
}

cmd="${1:-}"
dir="${2:-}"
[ -n "$cmd" ] && [ -n "$dir" ] || usage

case "$cmd" in
open)
    if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
        git fetch --quiet --depth 1 "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"
        git worktree add --quiet -B "$BRANCH" "$dir" "$REMOTE/$BRANCH"
    else
        # First run: a branch with no history and none of the code in it.
        git worktree add --quiet --detach "$dir"
        git -C "$dir" checkout --quiet --orphan "$BRANCH"
        git -C "$dir" rm -rf --quiet . || true
    fi
    ;;
save)
    git -C "$dir" add -A
    if git -C "$dir" diff --cached --quiet; then
        echo "usage stats: nothing changed"
        exit 0
    fi
    git -C "$dir" \
        -c user.name="${STATS_AUTHOR_NAME:-github-actions[bot]}" \
        -c user.email="${STATS_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}" \
        commit --quiet -m "chore: refresh usage stats"
    git -C "$dir" push --quiet "$REMOTE" "HEAD:refs/heads/$BRANCH"
    echo "usage stats: published"
    ;;
*)
    usage
    ;;
esac

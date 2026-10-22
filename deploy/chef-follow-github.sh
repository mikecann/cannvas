#!/usr/bin/env bash
# Move Chef's main on Code Storage to the commit CI just deployed.
#
# Chef's cloud builds start from Chef's main, which only moves on "Ship it"
# or `chef sync`. GitHub's main gets pushed (and deployed by
# .github/workflows/deploy-production.yml) far more often, so without this
# Chef would build on an old base. The workflow runs it after `convex
# deploy`, with the prod deploy key in CONVEX_DEPLOY_KEY.
#
# It never forces: `chef sync` only fast-forwards Chef's main, and refuses
# (failing the job) if Chef's main has commits this one doesn't, which the
# deploy guard before the deploy makes a race with a Ship it. It passes,
# doing nothing, while Chef isn't set up on the deployment.
set -euo pipefail

cd "$(dirname "$0")/.."
# `chef sync` always pushes through the remote called chef.
chef_remote=chef

log() {
  echo "chef-follow-github: $*"
}

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT
if ! status=$(pnpm exec convex run --prod chef:chefSetupStatus '{}' 2>"$errors"); then
  # Chef's functions aren't deployed here: nothing to follow (as chef guard).
  if grep -Eqi "Could not find|not found|No such function|unknown function" "$errors"; then
    log "Chef isn't on this deployment; nothing to sync"
    exit 0
  fi
  tail -n 5 "$errors" >&2
  exit 1
fi

# The repo's remote URL, only when Chef's repo exists (npx chef init --cloud
# --prod makes it) and the URL is a plain https one with no credentials.
url=$(node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let status;
    try { status = JSON.parse(s); } catch { status = null; }
    const raw = status && status.repo && status.remoteUrl;
    let url;
    try { url = new URL(raw); } catch { return; }
    if (url.protocol === "https:" && !url.username && !url.password) process.stdout.write(url.toString());
  });
' <<<"$status")
if [ -z "$url" ]; then
  log "Chef has no repo on this deployment yet; nothing to sync"
  exit 0
fi

# The remote and its credential helper, as `npx chef init` sets them up: the
# helper asks the deployment for a short-lived Code Storage token.
if existing=$(git remote get-url "$chef_remote" 2>/dev/null); then
  [ "$existing" = "$url" ] || { echo "chef-follow-github: git remote '$chef_remote' isn't Chef's repo" >&2; exit 1; }
else
  git remote add "$chef_remote" "$url"
fi
key="credential.$url"
git config --local --unset-all "$key.helper" >/dev/null 2>&1 || true
git config --local --add "$key.helper" ""
git config --local --add "$key.helper" '!f() { cd "$(git rev-parse --show-toplevel)" && pnpm exec chef git-credential --prod "$@"; }; f'
git config --local "$key.useHttpPath" true

pnpm exec chef sync --prod
log "Chef's main is $(git rev-parse --short HEAD), what was just deployed"

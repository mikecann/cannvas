#!/usr/bin/env bash
# Put what Chef shipped on the wall.
#
# "Ship it" (in an email or the Chef panel) deploys a build's backend to the
# deployment CHEF_DEPLOY_KEY is for and moves main in Chef's repo on Code
# Storage. The wall's screen is served from the Pi, so it only changes when
# this runs:
#
#   1. fetch GitHub's main and Chef's main
#   2. fast-forward this checkout's main to Chef's (never a merge or a force).
#      It refuses if GitHub's main or this checkout has commits Chef's main
#      doesn't, so it only ever pushes and deploys exactly Chef's main
#   3. push main to GitHub
#   4. pnpm install, then deploy/deploy.sh (pnpm build:mirror, upload, switch)
#
# Run it from a clean checkout of main with .env.local in place.
#
# Settings (environment variables):
#   CHEF_REMOTE    the git remote for Chef's repo (default: chef)
#   GITHUB_REMOTE  the git remote for GitHub (default: origin)
set -euo pipefail

cd "$(dirname "$0")/.."
chef_remote=${CHEF_REMOTE:-chef}
github_remote=${GITHUB_REMOTE:-origin}

die() {
  echo "ship-from-chef: $*" >&2
  exit 1
}

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "check out main first"
[ -z "$(git status --porcelain)" ] || die "commit or stash your changes first"
git remote get-url "$chef_remote" >/dev/null 2>&1 \
  || die "no git remote '$chef_remote'. npx chef init adds it (CHEF_REMOTE picks another name)"
[ -f .env.local ] || die ".env.local is missing; deploy/deploy.sh needs the kiosk's tokens from it"

git fetch "$github_remote" main
git fetch "$chef_remote" main
chef_main=$(git rev-parse "$chef_remote/main")
github_main=$(git rev-parse "$github_remote/main")

# Chef builds on top of main and Ship it only fast-forwards it, so GitHub's
# main should be behind Chef's, or level with it.
if ! git merge-base --is-ancestor "$github_main" "$chef_main"; then
  die "GitHub's main has commits Chef's main doesn't. Bring them together first:
  git merge $github_remote/main && git merge $chef_remote/main && npx chef sync
then run this again."
fi

# This checkout's main must not have anything Chef's main doesn't either,
# or the push and deploy below would ship it too.
if ! git merge-base --is-ancestor HEAD "$chef_main"; then
  die "this checkout's main has commits Chef's main doesn't ($(git rev-list --count "$chef_main"..HEAD) of them).
Push them to GitHub and Chef first (git push $github_remote main && npx chef sync), or drop them, then run this again."
fi

git merge --ff-only "$chef_main"
[ "$(git rev-parse HEAD)" = "$chef_main" ] || die "main isn't at Chef's main ($chef_main) after the merge; stopping"
git push "$github_remote" "$chef_main:refs/heads/main"
pnpm install --frozen-lockfile
deploy/deploy.sh
echo "ship-from-chef: the wall is on $(git rev-parse --short HEAD), Chef's main."

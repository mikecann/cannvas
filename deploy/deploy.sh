#!/usr/bin/env bash
# Build Cannvas and deploy it to the Pi, or roll back to the previous release.
#
#   deploy/deploy.sh             build, upload, switch, health check, prune
#   deploy/deploy.sh rollback    switch back to the previous release
#
# Settings (environment variables):
#   CANNVAS_HOST        ssh host of the Pi (default: cannvas)
#   CANNVAS_BUILD       build command (default: pnpm build:mirror)
#   CANNVAS_DIST        build output directory copied into www/ (default: dist)
#   CANNVAS_SKIP_BUILD  set to 1 to deploy the existing build output
#   CANNVAS_KEEP        releases to keep besides current and previous (default: 5)
#
# Each release is /opt/cannvas/releases/<YYYYmmdd-HHMMSS>-<sha> owned by root:
#   www/             the web build, the only directory cannvas-server serves
#   cannvas-server   the local server started by cannvas-web.service
#   RELEASE          the release name
set -euo pipefail

cd "$(dirname "$0")/.."
host=${CANNVAS_HOST:-cannvas}
build=${CANNVAS_BUILD:-pnpm build:mirror}
dist=${CANNVAS_DIST:-dist}
keep=${CANNVAS_KEEP:-5}
command=${1:-deploy}

# These values end up in a remote shell command, so accept only plain values.
if ! [[ $keep =~ ^[0-9]+$ ]]; then
  echo "CANNVAS_KEEP must be a whole number" >&2
  exit 2
fi

# Runs on the Pi as root. $1 is the action, $2 the release name.
read -r -d '' remote <<'REMOTE' || true
set -eu
root=/opt/cannvas
releases=$root/releases
action=$1
name=${2:-}
keep=${3:-5}

healthy() {
  attempt=0
  while [ "$attempt" -lt 20 ]; do
    if curl -fs -o /dev/null --max-time 5 http://127.0.0.1:4173/; then
      # Releases with www/ have /api/health, which checks only the server
      # (not Home Assistant), and must not expose the files beside www/.
      # Older releases predate both.
      if [ ! -d "$root/current/www" ] || {
        curl -fs -o /dev/null --max-time 5 http://127.0.0.1:4173/api/health \
          && [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/cannvas-server)" = 404 ]
      }; then
        return 0
      fi
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

restart_web() {
  # A broken release crash-loops into systemd's start limit. Clear it so the
  # restart that follows (including the one restoring the old release) runs.
  systemctl reset-failed cannvas-web.service 2>/dev/null || true
  systemctl restart cannvas-web.service
}

point_current_at() {
  # A rename is atomic, so the web server never sees a missing or half-made link.
  ln -sfn "$1" "$root/current.new"
  mv -T "$root/current.new" "$root/current"
}

restart_kiosk() {
  uid=$(id -u pi)
  if ! sudo -u pi XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user restart cannvas-kiosk.service; then
    echo "Warning: could not restart the kiosk; restart it by hand to load the new client" >&2
  fi
}

prune() {
  current=$(readlink -f "$root/current")
  previous=$(readlink -f "$root/previous" 2>/dev/null || true)
  kept=0
  # Newest first by modification time. Deploys touch each release they create.
  for release in $(ls -1dt "$releases"/*/); do
    release=${release%/}
    if [ "$release" = "$current" ] || [ "$release" = "$previous" ]; then
      continue
    fi
    kept=$((kept + 1))
    if [ "$kept" -gt "$keep" ]; then
      rm -rf -- "$release"
    fi
  done
}

activate() {
  target=$1
  # On the very first deploy there is no current release to return to.
  before=
  if [ -d "$root/current" ]; then
    before=$(readlink -f "$root/current")
  fi
  point_current_at "$target"
  # A failed restart counts as a failed health check, so it rolls back too.
  if restart_web && healthy; then
    [ -z "$before" ] || ln -sfn "$before" "$root/previous"
    restart_kiosk
    prune
    echo "Cannvas is running $(basename "$target") (previous: ${before:+$(basename "$before")})"
    return 0
  fi
  journalctl -u cannvas-web.service -n 20 --no-pager >&2 || true
  if [ -z "$before" ]; then
    echo "$(basename "$target") failed its health check and there is no earlier release" >&2
    rm -f "$root/current"
    exit 1
  fi
  echo "$(basename "$target") failed its health check; restoring $(basename "$before")" >&2
  point_current_at "$before"
  if ! restart_web || ! healthy; then
    echo "Warning: $(basename "$before") is not healthy either" >&2
  fi
  exit 1
}

case "$action" in
  deploy)
    release="$releases/$name"
    archive="/tmp/cannvas-$name.tgz"
    [ ! -e "$release" ] || { echo "$release already exists" >&2; exit 1; }
    # Remove a half-extracted release so the same name can be retried.
    trap 'rm -rf "$release" "$archive"' EXIT
    mkdir -p "$release"
    tar -xzf "$archive" -C "$release"
    rm -f "$archive"
    chown -R root:root "$release"
    chmod -R u+rwX,go+rX,go-w "$release"
    touch "$release"
    if [ ! -f "$release/www/index.html" ] || [ ! -x "$release/cannvas-server" ]; then
      echo "Incomplete release" >&2
      exit 1
    fi
    trap - EXIT
    activate "$release"
    ;;
  rollback)
    current=$(readlink -f "$root/current")
    target=$(readlink -f "$root/previous" 2>/dev/null || true)
    if [ -z "$target" ] || [ ! -d "$target" ] || [ "$target" = "$current" ]; then
      target=$(ls -1dt "$releases"/*/ | sed 's:/$::' | grep -vx "$current" | head -n 1)
    fi
    [ -n "$target" ] || { echo "No release to roll back to" >&2; exit 1; }
    activate "$target"
    ;;
  *)
    echo "Unknown action $action" >&2
    exit 2
    ;;
esac
REMOTE

run_remote() {
  # Quote each argument for the remote shell.
  ssh "$host" "sudo sh -s -- $(printf '%q ' "$@")" <<<"$remote"
}

case "$command" in
  rollback)
    run_remote rollback - "$keep"
    ;;
  deploy)
    sha=$(git rev-parse --short HEAD)
    [ -z "$(git status --porcelain)" ] || sha="$sha-dirty"
    name="$(date +%Y%m%d-%H%M%S)-$sha"

    if [ "${CANNVAS_SKIP_BUILD:-0}" != 1 ]; then
      $build
    fi
    [ -f "$dist/index.html" ] || { echo "$dist/index.html is missing; set CANNVAS_DIST" >&2; exit 1; }

    stage=$(mktemp -d)
    trap 'rm -rf "$stage"' EXIT
    # mktemp makes a private directory, and tar records its mode for the release.
    chmod 0755 "$stage"
    mkdir "$stage/www"
    cp -R "$dist/." "$stage/www/"
    cp deploy/cannvas-server "$stage/"
    chmod 0755 "$stage/cannvas-server"
    echo "$name" >"$stage/RELEASE"
    find "$stage" -name .DS_Store -delete

    # Root-owned files with no macOS extended attributes or ._ resource files.
    # --no-mac-metadata exists only in bsdtar (macOS); GNU tar rejects it.
    tar_flags=(--no-xattrs --owner=0 --group=0)
    if tar --version 2>/dev/null | grep -q bsdtar; then
      tar_flags+=(--no-mac-metadata)
    fi
    COPYFILE_DISABLE=1 tar "${tar_flags[@]}" -czf - -C "$stage" . \
      | ssh "$host" "cat > /tmp/cannvas-$name.tgz"
    run_remote deploy "$name" "$keep"
    ;;
  *)
    echo "Usage: $0 [deploy|rollback]" >&2
    exit 2
    ;;
esac

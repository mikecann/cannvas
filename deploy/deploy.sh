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
    if curl -fs -o /dev/null --max-time 5 http://127.0.0.1:4173/ \
      && curl -fs -o /dev/null --max-time 15 http://127.0.0.1:4173/api/solar; then
      # Releases with www/ must not expose the files beside it.
      if [ ! -d "$root/current/www" ] \
        || [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/cannvas-server)" = 404 ]; then
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
  before=$(readlink -f "$root/current")
  point_current_at "$target"
  restart_web
  if healthy; then
    ln -sfn "$before" "$root/previous"
    restart_kiosk
    prune
    echo "Cannvas is running $(basename "$target") (previous: $(basename "$before"))"
    return 0
  fi
  echo "$(basename "$target") failed its health check; restoring $(basename "$before")" >&2
  journalctl -u cannvas-web.service -n 20 --no-pager >&2 || true
  point_current_at "$before"
  restart_web
  healthy || echo "Warning: $(basename "$before") is not healthy either" >&2
  exit 1
}

case "$action" in
  deploy)
    release="$releases/$name"
    archive="/tmp/cannvas-$name.tgz"
    [ ! -e "$release" ] || { echo "$release already exists" >&2; exit 1; }
    mkdir -p "$release"
    tar -xzf "$archive" -C "$release"
    rm -f "$archive"
    chown -R root:root "$release"
    chmod -R u+rwX,go+rX,go-w "$release"
    touch "$release"
    [ -f "$release/www/index.html" ] && [ -x "$release/cannvas-server" ] || { echo "Incomplete release" >&2; exit 1; }
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
  ssh "$host" "sudo sh -s -- $*" <<<"$remote"
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
    COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --owner=0 --group=0 -czf - -C "$stage" . \
      | ssh "$host" "cat > /tmp/cannvas-$name.tgz"
    run_remote deploy "$name" "$keep"
    ;;
  *)
    echo "Usage: $0 [deploy|rollback]" >&2
    exit 2
    ;;
esac

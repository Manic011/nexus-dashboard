#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { printf '%s\n' "$*" >&2; exit 1; }

verify_only=false
origin=
case ${1:-} in
  --verify-only) verify_only=true ;;
  -*) fail 'Usage: sudo bash stackjetty-install.sh [browser-origin] or bash stackjetty-install.sh --verify-only' ;;
  *) origin=${1:-} ;;
esac
if (( $# > 1 )); then fail 'Pass at most one argument.'; fi

[[ $(uname -s) == Linux ]] || fail 'Run this installer on Ubuntu.'
source /etc/os-release
[[ ${ID:-} == ubuntu ]] || fail 'Run this installer on Ubuntu.'

if [[ $verify_only == false ]]; then
  [[ $EUID == 0 ]] || fail 'Rerun with sudo to install the systemd service.'
  [[ -d /run/systemd/system ]] || fail 'Ubuntu must be running systemd.'
  for path in /opt/nexus-dashboard /etc/nexus-dashboard /var/lib/nexus-dashboard /etc/systemd/system/nexus-dashboard.service; do
    [[ ! -e $path && ! -L $path ]] || fail "Existing StackJetty installation found at $path. See the upgrade guide."
  done
  if getent passwd nexus-dashboard >/dev/null || getent group nexus-dashboard >/dev/null ||
    systemctl cat nexus-dashboard.service >/dev/null 2>&1; then
    fail 'The StackJetty service account or unit already exists. See the upgrade guide.'
  fi
  if command -v ss >/dev/null && [[ -n $(ss -ltnH 'sport = :3000') ]]; then
    fail 'Port 3000 is occupied.'
  fi
  if [[ -z $origin ]]; then
    read -r -p 'Dashboard browser origin (scheme, host, and port if needed): ' origin </dev/tty
  fi
  [[ $origin =~ ^https?://[A-Za-z0-9.:-]+$ ]] || fail 'Enter an HTTP or HTTPS origin without a path or trailing slash.'
fi

stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
payload_line=$(LC_ALL=C awk '/^__NEXUS_ARCHIVE_BELOW__$/ { print NR + 1; exit }' "$0")
[[ -n $payload_line ]] || fail 'The installer archive is missing.'
tail -n +"$payload_line" "$0" > "$stage/release.tar.gz"
printf '%s  %s\n' '@ARCHIVE_SHA256@' "$stage/release.tar.gz" | sha256sum --check --status ||
  fail 'The bundled release checksum did not match.'

if [[ $verify_only == false ]]; then
  packages=()
  command -v ss >/dev/null || packages+=(iproute2)
  command -v useradd >/dev/null || packages+=(passwd)
  command -v tar >/dev/null || packages+=(tar)
  command -v gzip >/dev/null || packages+=(gzip)
  [[ -s /etc/ssl/certs/ca-certificates.crt ]] || packages+=(ca-certificates)
  for package in libstdc++6 libgcc-s1; do
    if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) != 'install ok installed' ]]; then
      packages+=("$package")
    fi
  done
  if (( ${#packages[@]} > 0 )); then
    apt-get update
    apt-get install -y "${packages[@]}"
  fi
fi

mkdir "$stage/release"
tar --extract --gzip --file "$stage/release.tar.gz" --directory "$stage/release" --no-same-owner --no-same-permissions
release="$stage/release"
chmod u+x "$release/runtime/bin/node"
if ! "$release/runtime/bin/node" -e '
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 22 || (minor === 22 && patch < 3)) process.exit(1);
  require("node:sqlite");
'; then
  fail 'Use a compatible Node.js 24.x runtime (24.22.3 or newer) for this Ubuntu architecture.'
fi
for path in dist/index.html server/index.ts server/state-backup.ts node_modules/zod/package.json node_modules/multicast-dns/package.json deploy/nexus-dashboard.service; do
  [[ -f $release/$path ]] || fail "The release is missing $path."
done
bash -n "$release/deploy/install.sh"
if [[ $verify_only == true ]]; then
  printf 'Verified release bundle and Node.js runtime (%s).\n' "$(uname -m)"
  exit 0
fi

# Compare with Node's canonical origin so browser writes use the same origin.
if ! "$release/runtime/bin/node" -e 'if (URL.parse(process.argv[1])?.origin !== process.argv[1]) process.exit(1)' "$origin"; then
  fail 'Use the canonical browser origin, omitting explicit default ports.'
fi
bash "$release/deploy/install.sh" "$release" "$origin"
printf '\nOpen %s to create the administrator.\n' "$origin"
printf '%s\n' "Read the first-run setup token in your private terminal:" \
  "  sudo sed -n 's/^NEXUS_SETUP_TOKEN=//p' /etc/nexus-dashboard/nexus.env"
exit 0
__NEXUS_ARCHIVE_BELOW__

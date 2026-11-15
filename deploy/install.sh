#!/usr/bin/env bash
set -euo pipefail
umask 077
release=$(realpath "${1:?Provide the staged release directory}")
origin=${2:?Provide the browser origin}
state=${3:-}
[[ $(id -u) = 0 ]]
[[ $origin =~ ^https?://[A-Za-z0-9.:-]+$ ]]
for path in /opt/nexus-dashboard /etc/nexus-dashboard /var/lib/nexus-dashboard /etc/systemd/system/nexus-dashboard.service; do
  if [[ -e $path || -L $path ]]; then echo "Already exists: $path" >&2; exit 1; fi
done
if getent passwd nexus-dashboard >/dev/null || getent group nexus-dashboard >/dev/null || systemctl cat nexus-dashboard.service >/dev/null 2>&1; then
  echo "The service account or service already exists." >&2
  exit 1
fi
if [[ -n $(ss -ltnH 'sport = :3000') ]]; then
  echo 'Port 3000 is occupied.' >&2
  exit 1
fi
for path in runtime/bin/node server/index.ts dist/index.html package.json node_modules/zod/package.json node_modules/multicast-dns/package.json server/state-backup.ts deploy/nexus-dashboard.service; do
  test -f "$release/$path"
done
for directory in runtime server dist node_modules; do
  [[ ! -L "$release/$directory" ]] || { echo 'Top-level release directories must not be symlinks.' >&2; exit 1; }
done
# Reject dependencies that resolve outside the staged release.
while IFS= read -r -d '' link; do
  target=$(realpath -e "$link")
  [[ $target == "$release/"* ]] || { echo 'Release contains an external symlink.' >&2; exit 1; }
done < <(find "$release" -type l -print0)
"$release/runtime/bin/node" -e 'const [major, minor, patch] = process.versions.node.split(".").map(Number); if (major !== 24 || minor < 22 || (minor === 22 && patch < 3)) process.exit(1)'
if [[ -n $state ]]; then
  state=$(realpath -e "$state")
  test -f "$state/nexus.sqlite"
fi
token=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
useradd --system --user-group --home-dir /var/lib/nexus-dashboard --shell /usr/sbin/nologin nexus-dashboard
install -d -m 0755 /opt/nexus-dashboard
cp -R "$release"/{runtime,server,dist,package.json,node_modules} /opt/nexus-dashboard/
chown -R root:root /opt/nexus-dashboard
chmod -R a+rX /opt/nexus-dashboard
install -d -m 0700 -o nexus-dashboard -g nexus-dashboard /var/lib/nexus-dashboard
if [[ -n $state ]]; then
  "$release/runtime/bin/node" "$release/server/state-backup.ts" backup "$state/nexus.sqlite" /var/lib/nexus-dashboard/nexus.sqlite
  chown nexus-dashboard:nexus-dashboard /var/lib/nexus-dashboard/nexus.sqlite
fi
install -d -m 0700 /etc/nexus-dashboard
host=0.0.0.0
if [[ $origin = https:* ]]; then host=127.0.0.1; fi
printf 'NEXUS_HOST=%s\nNEXUS_PORT=3000\nNEXUS_ORIGIN=%s\nNEXUS_SETUP_TOKEN=%s\n' "$host" "$origin" "$token" > /etc/nexus-dashboard/nexus.env
install -m 0644 "$release/deploy/nexus-dashboard.service" /etc/systemd/system/nexus-dashboard.service
systemctl daemon-reload
systemctl enable --now nexus-dashboard.service
if ! /opt/nexus-dashboard/runtime/bin/node --input-type=module -e '
  for(let attempt=0;attempt<30;attempt++) {
    try { const r=await fetch("http://127.0.0.1:3000/healthz",{signal:AbortSignal.timeout(1000)}); if(r.ok && (await r.json()).status==="ok") process.exit(0); } catch {}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  process.exit(1);
'; then
  systemctl stop nexus-dashboard.service
  echo 'Startup health check failed. Installation was retained for diagnosis; inspect the service journal.' >&2
  exit 1
fi
echo 'StackJetty Dashboard installed; service health check passed.'

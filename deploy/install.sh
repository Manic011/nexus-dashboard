#!/usr/bin/env bash
set -euo pipefail
umask 077
release=$(realpath "${1:?Provide the staged release directory}")
origin=${2:?Provide the browser origin}
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
for path in runtime/bin/node server/index.ts dist/index.html package.json node_modules/zod/package.json deploy/nexus-dashboard.service; do
  test -f "$release/$path"
done
"$release/runtime/bin/node" --version
token=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
useradd --system --user-group --home-dir /var/lib/nexus-dashboard --shell /usr/sbin/nologin nexus-dashboard
install -d -m 0755 /opt/nexus-dashboard
cp -R "$release"/{runtime,server,dist,package.json,node_modules} /opt/nexus-dashboard/
chown -R root:root /opt/nexus-dashboard
chmod -R a+rX /opt/nexus-dashboard
install -d -m 0700 /etc/nexus-dashboard
host=0.0.0.0
if [[ $origin = https:* ]]; then host=127.0.0.1; fi
printf 'NEXUS_HOST=%s\nNEXUS_PORT=3000\nNEXUS_ORIGIN=%s\nNEXUS_SETUP_TOKEN=%s\n' "$host" "$origin" "$token" > /etc/nexus-dashboard/nexus.env
install -m 0644 "$release/deploy/nexus-dashboard.service" /etc/systemd/system/nexus-dashboard.service
systemctl daemon-reload
systemctl enable --now nexus-dashboard.service

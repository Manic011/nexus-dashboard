# Native Ubuntu installation

Nexus Dashboard can run as a systemd service on Ubuntu. Build the application on a workstation and transfer the tested release to the server. The current installer performs a first installation from a staged bundle.

## Requirements

- Ubuntu with systemd, sudo access, and an available TCP port 3000 for the initial install.
- Git and Node.js 24.14.1 or newer within 24.x on the build workstation.
- An official Node.js 24.x Linux runtime for the target CPU architecture. Verify the archive against the signed checksums for that release. On the server, `uname -m` reports the architecture. [Node.js downloads and verification instructions](https://nodejs.org/en/download)
- The final browser origin, such as `https://dashboard.example.net` behind a reverse proxy or `http://SERVER:3000` on a trusted test network.

## Build and stage the release

From the repository root on the workstation, run:

```sh
npm ci
npm run build
npm test
```

Create a clean staging directory. This example uses Bash or Git Bash:

```bash
stage="$(mktemp -d)"
cp -R dist server deploy package.json package-lock.json "$stage/"
npm ci --omit=dev --prefix "$stage"
```

Extract the verified Linux Node.js distribution so that the executable is at `$stage/runtime/bin/node`. For an official `.tar.xz` archive:

```bash
mkdir -p "$stage/runtime"
tar -xJf /path/to/verified-node-linux.tar.xz -C "$stage/runtime" --strip-components=1
tar -czf nexus-dashboard-release.tar.gz -C "$stage" .
```

Transfer the archive over SSH. On Ubuntu, extract it into an empty directory owned by the operator. From that directory, verify that the runtime works and that the installer parses:

```bash
./runtime/bin/node --version
bash -n deploy/install.sh
ss -ltn 'sport = :3000'
```

Use the archive from the build you tested. If a preview already occupies port 3000, coordinate stopping that preview before installing the service.

## Install and create the administrator

Run this from the extracted release directory. Replace the example origin with the URL you will use in your browser.

```bash
sudo bash deploy/install.sh "$PWD" "https://dashboard.example.net"
sudo systemctl status nexus-dashboard --no-pager
curl --fail http://127.0.0.1:3000/healthz
```

The installer checks for existing Nexus paths, the service account, and port conflicts. It creates a dedicated `nexus-dashboard` system user, protects configuration, and enables the service. An HTTPS origin binds Nexus to loopback for a reverse proxy on the same host. An HTTP origin binds to all interfaces on port 3000.

Read the setup token from the server in a private terminal:

```bash
sudo sed -n 's/^NEXUS_SETUP_TOKEN=//p' /etc/nexus-dashboard/nexus.env
```

Open the configured URL, enter the token, and create the first administrator. Use the same scheme, hostname, and port you supplied to the installer. The setup token is only used for first-run account creation.

## Files and settings

| Path | Purpose |
| --- | --- |
| `/opt/nexus-dashboard` | Application, production dependencies, and Linux Node.js runtime. |
| `/etc/nexus-dashboard/nexus.env` | Protected environment file read by systemd. |
| `/var/lib/nexus-dashboard` | Persistent SQLite state, including tiles, accounts, and sessions. |
| `/etc/systemd/system/nexus-dashboard.service` | Service definition. |

| Setting | Meaning |
| --- | --- |
| `NEXUS_HOST` | Bind address. The app default is `127.0.0.1`. |
| `NEXUS_PORT` | Listen port. Defaults to `3000`. |
| `NEXUS_ORIGIN` | Exact browser origin used for write requests and cookie security. Defaults to loopback HTTP on the configured port. |
| `NEXUS_DATA` | SQLite state directory. Defaults to `data` locally. The systemd service uses `/var/lib/nexus-dashboard`. |
| `NEXUS_DIST` | Directory containing the built frontend. Defaults to `dist` relative to the working directory. |
| `NEXUS_SETUP_TOKEN` | Secret used when creating the first administrator. |
| `NEXUS_JELLYFIN_URL` | Jellyfin base URL, including a proxy subpath when required. |
| `NEXUS_JELLYFIN_API_KEY` | Jellyfin API key used only on the server. |

Edit the environment file with `sudoedit /etc/nexus-dashboard/nexus.env` and restart the service after changes. Keep this file readable only by the administrator.

## HTTPS behind a reverse proxy

Terminate TLS on a reverse proxy with a certificate trusted by your browser. Proxy the dashboard origin to `http://127.0.0.1:3000`. For example, use this site block with an existing Caddy installation:

```caddyfile
dashboard.example.net {
    reverse_proxy 127.0.0.1:3000
}
```

Set `NEXUS_ORIGIN=https://dashboard.example.net` and `NEXUS_HOST=127.0.0.1`. Restart Nexus and open the HTTPS URL. The frontend and API share the same origin, and an HTTPS origin enables Secure session cookies.

## Jellyfin activity

Create an API key in Jellyfin administration. Add `NEXUS_JELLYFIN_URL` and `NEXUS_JELLYFIN_API_KEY` to the protected environment file. Use a trusted HTTPS URL when available. Restart Nexus, then add a tile with the same Jellyfin base URL. The tile displays the aggregate active stream count. The integration calls the configured Sessions endpoint with a four-second timeout and caches results for 30 seconds. [Jellyfin Sessions API source](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/SessionController.cs)

## Backup, upgrade, and recovery

The dashboard's JSON export contains tiles and tags. A full instance backup includes the application, protected configuration, and the entire state directory. Stop the service before taking that backup so the SQLite database and its sidecar files are copied together.

```bash
sudo systemctl stop nexus-dashboard
sudo tar -czf /root/nexus-dashboard-backup.tar.gz -C / \
  opt/nexus-dashboard etc/nexus-dashboard var/lib/nexus-dashboard \
  etc/systemd/system/nexus-dashboard.service
sudo systemctl start nexus-dashboard
```

Store the archive securely because it contains deployment secrets and authentication state. Test a new release against a copy of the state before upgrading. For a manual upgrade, stop the service, back up the current release and state, and replace the application files with the staged release while preserving the environment and state directories. Keep the service stopped until the files are in place. Start Nexus and check `/healthz`, sign-in, and saved tiles.

If an upgrade fails, stop the service. Restore the previous application files, environment, and database state from the same backup, including any SQLite sidecar files. Reload systemd if the service definition changed and start the service. The first-install script rejects an existing installation.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Service exits during startup | Run `sudo journalctl -u nexus-dashboard -n 100 --no-pager`. Check the Linux runtime architecture, release contents, and SQLite schema compatibility. |
| Page loads, but sign-in or saving returns 403 | Check that the exact browser origin matches `NEXUS_ORIGIN`, and confirm proxy routing sends both the frontend and API to Nexus. |
| Browser cannot connect | Check `sudo systemctl status nexus-dashboard`, the listen address and port, and the reverse proxy. Run `curl --fail http://127.0.0.1:3000/healthz` on Ubuntu. |
| First-run token is rejected | Check that you are connecting to the intended instance and using the token from its protected environment file. |
| Jellyfin reports unavailable | Check the configured base URL, API key, network reachability, and the server's trust of the upstream HTTPS certificate. |

## Planned one-line installer

A future Ubuntu installer should fetch a pinned release, verify its artifact, check the host and port, install the systemd service, and print the next setup step. An upgrade path should preserve data and include a tested rollback procedure. Track the work in the release roadmap. [Development status](DEVELOPMENT_STATUS.md)

## Discovery state and network access

Scan profiles and the last 20 scan results are stored in the same SQLite database as the dashboard. Back up the full state directory to preserve them. Tile JSON exports and configuration snapshots do not include these records. The discovery/import refinement uses schema 4 and does not require an additional migration.

Ubuntu must have a route from the selected source interface to each requested private subnet. Permit the relevant outbound HTTP/HTTPS traffic and local mDNS where desired. Nexus does not install routes, modify firewall rules, or bridge mDNS between networks. Do not expose the application publicly for network discovery. Scans have no overall deadline; proxies must allow long-running responses. A service restart interrupts any active scan. See the user guide for target syntax, limits, and cancellation behavior.

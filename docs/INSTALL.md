# Native Ubuntu installation

StackJetty can run as a systemd service on Ubuntu. Build the application on a workstation and transfer the tested release to the server. The current installer performs a first installation from a staged bundle and can deliberately import an existing schema 4 or 5 state directory. It refuses to overwrite existing installation paths.

The workstation steps below use Bash, or Git Bash on Windows. After transferring the archive, run the remaining commands in a Bash session on Ubuntu. For a local Windows run, see [Local development](LOCAL_DEVELOPMENT.md#windows-powershell).

## One-command install from a bundle

Obtain the installer bundle and its SHA-256 checksum from your release operator, or [build them from a locally tested release](#build-the-one-command-installer). Copy both files to a fresh staging directory on Ubuntu. Run these commands there:

```bash
sha256sum -c stackjetty-install.sha256 &&
  sudo bash stackjetty-install.sh
```

The installer prompts for the exact dashboard origin and installs any missing Ubuntu packages it needs using APT. The bundle includes the Linux Node.js runtime, production dependencies, and built app. Ubuntu needs sudo access, systemd, a free port 3000, and access to its configured package repositories if packages are missing. Match the bundle to your server's architecture.

The install creates and starts the systemd service, checks its health, and prints the dashboard URL and the command to read the setup token. Create the administrator in your browser. For HTTPS, configure the [reverse proxy](#https-behind-a-reverse-proxy) before opening the dashboard. Install only on a fresh host or an Ubuntu host without an existing StackJetty installation. See [Backup, upgrade, and recovery](#backup-upgrade-and-recovery) for an existing installation.

The command uses a downloaded or transferred installer bundle. Obtain the checksum from a trusted source before running the installer with sudo. The installer also checks the embedded archive for corruption before extracting it. To inspect compatibility on Ubuntu without sudo or service changes, run `bash stackjetty-install.sh --verify-only`.

## Requirements

- An Ubuntu release receiving current security maintenance, with systemd, sudo access, and an available TCP port 3000 for the initial install.
- Git and Node.js 24.22.3 or newer within 24.x on the build workstation.
- An official Node.js 24.x Linux runtime for the target CPU architecture. Verify the archive against the signed checksums for that release. On the server, `uname -m` reports the architecture. [Node.js downloads and verification instructions](https://nodejs.org/en/download)
- The exact URL used to open StackJetty in a browser. For a trusted LAN test, use HTTP with your Ubuntu server's address and port 3000. For HTTPS, configure a [reverse proxy](#https-behind-a-reverse-proxy) on the server.

## On your workstation: Build and package

On GitHub, open the repository's **Code** menu to get the clone URL. Open Bash in the checkout directory containing `package.json` and run:

```bash
npm ci && npm run build && npm test
```

Continue after the checks pass. Download and verify the official Linux Node.js `.tar.xz` archive for the server's architecture. When prompted, enter the path to that archive. These commands create `stackjetty-release.tar.gz` in the project directory.

```bash
(
  set -e
  read -r -p 'Path to the verified Linux Node.js .tar.xz archive: ' runtime_archive
  stage="$(mktemp -d)"
  cp -R dist server deploy package.json package-lock.json "$stage/"
  npm ci --omit=dev --prefix "$stage"
  mkdir "$stage/runtime"
  tar -xJf "$runtime_archive" -C "$stage/runtime" --strip-components=1
  tar -czf stackjetty-release.tar.gz -C "$stage" .
)
```

Transfer the bundle over SSH. Enter the same `user@host` you normally use to connect to Ubuntu. Verify the server's SSH host key against a trusted record before proceeding.

```bash
read -r -p 'Ubuntu SSH login (user@host): ' ubuntu_login
scp stackjetty-release.tar.gz "${ubuntu_login}:stackjetty-release.tar.gz" &&
  ssh "$ubuntu_login"
```

## On Ubuntu: Unpack and check the release

Run this in the Ubuntu SSH session. The archive is in your login directory. Extract it to a fresh staging directory:

```bash
stage="$(mktemp -d)" &&
  tar -xzf ~/stackjetty-release.tar.gz -C "$stage" &&
  cd "$stage" &&
  chmod u+x runtime/bin/node &&
  ./runtime/bin/node --version &&
  bash -n deploy/install.sh &&
  ss -ltn 'sport = :3000'
```

Use the archive from the build you tested. If a preview already occupies port 3000, coordinate stopping that preview before installing the service.

## On Ubuntu: Install and create the administrator

Run this from the extracted release directory. At the prompt, enter the browser origin, including the scheme, host, and any nondefault port. Leave off the trailing slash and any path. For an HTTPS origin, configure the reverse proxy before opening the dashboard.

```bash
read -r -p 'Dashboard browser origin: ' browser_origin
sudo bash deploy/install.sh "$PWD" "$browser_origin" &&
  systemctl is-enabled nexus-dashboard &&
  systemctl is-active nexus-dashboard &&
  /opt/nexus-dashboard/runtime/bin/node --input-type=module -e '
    const response = await fetch("http://127.0.0.1:3000/healthz");
    if (!response.ok || (await response.json()).status !== "ok") process.exit(1);
    console.log("StackJetty is healthy");
  '
```

The installer checks the runtime version, staged-file boundaries, existing StackJetty paths, service account, port conflicts, and startup health. It creates a dedicated `nexus-dashboard` system user, protects configuration, and enables the service. An HTTPS origin binds StackJetty to loopback for a reverse proxy on the same host. An HTTP origin binds to all interfaces on port 3000.

Read the setup token from the server in a private terminal:

```bash
sudo sed -n 's/^NEXUS_SETUP_TOKEN=//p' /etc/nexus-dashboard/nexus.env
```

Open the configured URL, enter the token, and create the first administrator. Use the same scheme, hostname, and port you supplied to the installer. The setup token is only used for first-run account creation.

## Files and settings

StackJetty was previously called Nexus Dashboard. Existing deployments continue to use the `nexus-dashboard` systemd unit and directories, the `NEXUS_*` environment variables, and the same SQLite state. Update the application files in place to carry over your data and settings.

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
| `NEXUS_KASM_URL` | Optional HTTPS base URL for a separate Kasm Workspaces server. Enables the remote browser action for administrators. |
| `NEXUS_DISCOVERY` | `on` by default. Set to `off` to disable active web and mDNS discovery, interface enumeration, and scan profile endpoints. |
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

Set `NEXUS_ORIGIN=https://dashboard.example.net` and `NEXUS_HOST=127.0.0.1`. Restart StackJetty and open the HTTPS URL. The frontend and API share the same origin, and an HTTPS origin enables Secure session cookies. For a Cloudflare Tunnel, use the [private remote-access checklist](SECURITY.md#private-access-through-cloudflare).

## Remote browser with Kasm Workspaces

Set up Kasm on a supported LAN host with access to the services you intend to open. Kasm documents a 4 GB minimum for its services and additional resources for browser sessions. Give the Kasm host a trusted HTTPS URL that the user's browser can reach. [Kasm system requirements](https://docs.kasm.com/docs/install/system_requirements)

1. In Kasm, assign the user a default browser workspace and configure its documented launch and resume behavior for the **/go** URL. Use authenticated sessions. Limit the workspace's network access to the services that user is allowed to reach. [Kasm browser launch configuration](https://docs.kasm.com/docs/develop/tutorials/remote-browser-isolation)
2. Configure Kasm to support embedding from the StackJetty page. Use the provider's documented cookie settings and prefer sibling HTTPS hostnames under your control. If the sites use Cloudflare Access, verify both login flows. [Kasm iframe setup](https://docs.kasm.com/docs/develop/how-to/workspaces-sessions/container-workspace/embed-kasm-in-iframe)
3. Set `NEXUS_KASM_URL=https://browser.example.net/` in the protected StackJetty environment file and restart StackJetty. Open a saved tile as administrator, select **Open in remote browser**, and sign in to Kasm if prompted. Verify that the target loads in the StackJetty tab and **Return to direct view** works. End sessions from Kasm when finished.

StackJetty sends the saved tile URL to Kasm as the browser destination. Use tile URLs without secrets. Kasm manages authentication, browser sessions, and session expiry. Closing the StackJetty view disconnects the frame, while Kasm may keep the browser session running.

## Jellyfin activity

Create an API key in Jellyfin administration. Add `NEXUS_JELLYFIN_URL` and `NEXUS_JELLYFIN_API_KEY` to the protected environment file. Use a trusted HTTPS URL when available. Restart StackJetty, then add a tile with the same Jellyfin base URL. The tile displays the aggregate active stream count. The integration calls the configured Sessions endpoint with a four-second timeout and caches results for 30 seconds. [Jellyfin Sessions API source](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/SessionController.cs)

## Backup, upgrade, and recovery

The dashboard's JSON export contains tiles and tags. A full instance backup includes the application, protected configuration, and the entire state directory. Stop the service before taking that backup so the SQLite database and its sidecar files are copied together.

```bash
sudo systemctl stop nexus-dashboard
sudo tar -czf /root/stackjetty-backup.tar.gz -C / \
  opt/nexus-dashboard etc/nexus-dashboard var/lib/nexus-dashboard \
  etc/systemd/system/nexus-dashboard.service
sudo systemctl start nexus-dashboard
```

Store the archive securely because it contains deployment secrets and authentication state. Test a new release against a copy of the state before upgrading. For a manual upgrade, stop the service, back up the current release and state, and replace the application files with the staged release while preserving the environment and state directories. Keep the service stopped until the files are in place. Start StackJetty and check `/healthz`, sign-in, and saved tiles.

If an upgrade fails, stop the service. Restore the previous application files, environment, and database state from the same backup, including any SQLite sidecar files. Reload systemd if the service definition changed and start the service. The first-install script rejects an existing installation.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Service exits during startup | Run `sudo journalctl -u nexus-dashboard -n 100 --no-pager`. Check the Linux runtime architecture, release contents, and SQLite schema compatibility. |
| Page loads, but sign-in or saving returns 403 | Check that the exact browser origin matches `NEXUS_ORIGIN`, and confirm proxy routing sends both the frontend and API to StackJetty. |
| Browser cannot connect | Check `systemctl is-active nexus-dashboard`, the listen address and port, and the reverse proxy. Run the Ubuntu health check from the installation step to confirm that the app responds on the server. |
| First-run token is rejected | Check that you are connecting to the intended instance and using the token from its protected environment file. |
| Jellyfin reports unavailable | Check the configured base URL, API key, network reachability, and the server's trust of the upstream HTTPS certificate. |

## Build the one-command installer

After [building and packaging the release](#on-your-workstation-build-and-package) on your workstation, run this from the repository root:

```bash
node deploy/make-installer.mjs stackjetty-release.tar.gz stackjetty-install.sh > stackjetty-install.sha256
```

Use a fresh output directory or move the previous installer before generating a new one. The generator refuses to overwrite an existing installer. Transfer the generated script and checksum over a trusted channel. Keep deployment state, credentials, and personal configuration out of the release archive.

## Discovery state and network access

Scan profiles and the last 20 scan results are stored in the same SQLite database as the dashboard. Back up the full state directory to preserve them. Tile JSON exports and configuration snapshots do not include these records. The discovery/import refinement uses schema 4 and does not require an additional migration.

Ubuntu must have a route from the selected source interface to each requested private subnet. Permit the relevant outbound HTTP/HTTPS traffic and local mDNS where desired. StackJetty does not install routes, modify firewall rules, or bridge mDNS between networks. Do not expose the application publicly for network discovery. Scans have no overall deadline; proxies must allow long-running responses. A service restart interrupts any active scan. See the user guide for target syntax, limits, and cancellation behavior.

## Adopt an existing preview

Stop the preview before transferring its state to the installed service. Keep the old release and a consistent database backup. From the extracted release directory on Ubuntu, use the third installer argument to import the existing state directory:

```bash
read -r -p 'Dashboard browser origin: ' browser_origin
read -r -p 'Absolute path to the existing StackJetty state directory: ' source_state
sudo bash deploy/install.sh "$PWD" "$browser_origin" "$source_state"
```

The source directory must contain a valid schema 4 or 5 `nexus.sqlite` with an administrator. The installer copies it consistently through the SQLite backup API into the new service state directory and sets ownership for the dedicated account. It leaves the source state in place. Existing integrations or extra environment settings must be migrated explicitly; the installer does not infer them from another process. Confirm tile, account, group, permission, profile, and history preservation after adoption.

The service code and runtime are root-owned. Configuration is root-readable only. The dedicated service account can write its state directory but cannot write application code or read the environment file directly; systemd supplies its configured values. Kernel, device, privilege, and filesystem restrictions are set in the unit. AF_NETLINK is retained so Linux interface enumeration works alongside HTTP and mDNS.

## Consistent database backup and offline recovery

This operator tool backs up the **database**, including accounts, permissions, profiles, and history. Environment configuration, release code, uploaded files if introduced later, and external integration secrets still require the full-instance backup procedure above. No browser endpoint exposes this database backup.

Create a backup in a protected location while the service is running:

```bash
sudo install -d -m 0700 /var/backups/nexus-dashboard
sudo /opt/nexus-dashboard/runtime/bin/node /opt/nexus-dashboard/server/state-backup.ts backup \
  /var/lib/nexus-dashboard/nexus.sqlite \
  /var/backups/nexus-dashboard/state-backup.sqlite
```

The destination must not already exist. The tool checks SQLite integrity, schema 4 or 5, required tables, and the presence of an administrator. It writes a consistent SQLite backup, switches the output to DELETE journal mode so no WAL/shared-memory sidecars need to travel with it, and restricts its file permissions. Use unique names or your own retention mechanism; automatic scheduling, encryption, and pruning are not implemented.

To recover, restore into a new directory first:

```bash
sudo /opt/nexus-dashboard/runtime/bin/node /opt/nexus-dashboard/server/state-backup.ts restore \
  /var/backups/nexus-dashboard/state-backup.sqlite \
  /var/lib/nexus-dashboard-recovered
sudo chown -R nexus-dashboard:nexus-dashboard /var/lib/nexus-dashboard-recovered
```

A populated destination is rejected. The restore keeps accounts and configuration but removes saved sessions, requiring users to sign in again. It does not alter the running service or overwrite its state.

Validate the recovered state on an isolated instance with a matching origin and free port, without exposing a second copy of real accounts publicly. For the final switch, stop the service and add a reviewed systemd drop-in setting `Environment=NEXUS_DATA=/var/lib/nexus-dashboard-recovered` and `ReadWritePaths=/var/lib/nexus-dashboard-recovered`. Run `sudo systemctl daemon-reload` and start the service. The extra write path is necessary because ProtectSystem=strict protects paths outside the managed StateDirectory. Keep the original directory for rollback. Removing that reviewed drop-in and restarting switches back. Do not mix a database backup with application code that cannot read its schema.

Protect and back up `/etc/nexus-dashboard/nexus.env` separately. Never place database backups, environment files, or real deployment screenshots in a release archive.

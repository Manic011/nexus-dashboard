# Nexus Dashboard

Nexus Dashboard is a self-hosted application launcher for homelabs. It helps you discover web services on your local network, organize them into a searchable dashboard, and share access with other users.

**Status:** Development preview. The application runs locally with Node.js and SQLite and can be staged for native installation on Ubuntu with systemd.

## Features

| Feature | What you can do |
| --- | --- |
| Application dashboard | Create, edit, and delete tiles. Group tiles by category, add multiple tags, and combine search with category and tag filters. |
| Appearance | Choose a light, dark, or system theme and comfortable or compact cards. |
| Service discovery | Scan reachable private IPv4 subnets with CIDRs, address ranges, exclusions, custom ports, reusable profiles, progress, and cancellation. Compare scans and review live identification evidence before importing or updating tiles. |
| Accounts and access | Create editor and viewer accounts, organize user groups, and restrict individual tiles by account or group. Shared read-only access is also available. |
| Tile backups | Export tiles as JSON; review new entries and explicitly update matching URLs. Save named server-side configuration snapshots and preview restore changes. Operators can also create and recover consistent full-database backups. |
| Jellyfin activity | Show the active stream count on a matching tile after configuring a Jellyfin URL and API key on the server. |
| Ubuntu deployment | Stage a built release and install it as a systemd service under a dedicated account. |

See the [release readiness audit](docs/RELEASE_READINESS.md) for verification results and remaining production gates, and [Privacy](PRIVACY.md) for data and publishing boundaries.

## Run locally

Install Git and Node.js **24.14.1 or newer within the 24.x series**. Replace `YOUR_REPOSITORY_URL` with the URL of your repository. With access to the repository, clone it and run the following from the checkout. [Node.js downloads](https://nodejs.org/en/download)

```sh
git clone YOUR_REPOSITORY_URL nexus-dashboard
cd nexus-dashboard
npm ci
npm run build
npm test
```

Set a random first-run setup token and start the server. In PowerShell:

```powershell
$env:NEXUS_SETUP_TOKEN = node -p "require('node:crypto').randomBytes(32).toString('hex')"
$env:NEXUS_SETUP_TOKEN
npm start
```

In Bash:

```bash
export NEXUS_SETUP_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
printf '%s\n' "$NEXUS_SETUP_TOKEN"
npm start
```

Open `http://127.0.0.1:3000` and use the token to create the first administrator. Choose a password of at least 12 characters. Local state is stored in `data/`.

## Install on Ubuntu

Build and test on a workstation, transfer the release to Ubuntu, and run the native installer from the staged bundle. The install guide covers packaging, the systemd service, first-run setup, HTTPS, Jellyfin, backups, and recovery. A one-line installer is planned. [Ubuntu installation guide](docs/INSTALL.md)

## Documentation

| Guide | Contents |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | Setup, dashboard editing, discovery, import, access, backups, and Jellyfin. |
| [Ubuntu installation](docs/INSTALL.md) | Build a release, install with systemd, configure HTTPS, and back up or recover a deployment. |
| [Service port catalog](docs/HOMELAB_PORTS.md) | Web ports used by discovery and how Nexus chooses a service name. |
| [Architecture and API](ARCHITECTURE.md) | Application layout, data model, authorization, and API reference. |
| [Contributing](CONTRIBUTING.md) | Development workflow, verification, and documentation requirements. |
| [Changelog](CHANGELOG.md) and [roadmap](docs/DEVELOPMENT_STATUS.md) | Implemented changes, remaining work, and release milestones. |

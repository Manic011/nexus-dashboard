# StackJetty Dashboard — Self-hosted homelab dashboard

StackJetty Dashboard is a self-hosted application launcher for homelabs. It helps you discover web services on your local network, organize them into a searchable dashboard, and share access with other users.

**Status:** Development preview. Built locally with Node.js and SQLite, with native Ubuntu systemd deployment and recovery paths verified in the development audit. Stable-release gates remain open.

## Features

| Feature | What you can do |
| --- | --- |
| Application dashboard | Create, edit, and delete tiles. Group tiles by category, add multiple tags, and combine search with category and tag filters. |
| Personal layouts | Rearrange cards directly in their category sections or on a custom grid. Adjust widths, category labels, order, and dividers, then preview the layout before saving. |
| Appearance | Choose a light, dark, or system theme and comfortable or compact cards. |
| Service view and vault | Open compatible services inside StackJetty and save logins in an encrypted browser vault. Choose a default or per-tile opening mode for a new browser tab, direct embedding, or Kasm. |
| Service discovery | Scan reachable private IPv4 subnets with CIDRs, address ranges, exclusions, custom ports, reusable profiles, progress, and cancellation. Compare scans and review live identification evidence before importing or updating tiles. |
| Accounts and access | Create editor and viewer accounts, organize user groups, and restrict individual tiles by account or group. Shared read-only access is also available. |
| Tile backups | Export tiles as JSON; review new entries and explicitly update matching URLs. Save named server-side configuration snapshots and preview restore changes. Operators can also create and recover consistent full-database backups. |
| Jellyfin activity | Show the active stream count on a matching tile after configuring a Jellyfin URL and API key on the server. |
| Ubuntu deployment | Stage a built release and install it as a systemd service under a dedicated account. |
| Diagnostics | Open Diagnostics from the main header to inspect uptime and host metrics, test the connection, and launch services using their tile preferences. |
| SSH machines | Switch between concurrent sessions from the main navigation. View Linux statistics, manage files over SFTP, and use interactive shells. Sign in with a password or key, with optional encrypted browser storage for passwords. |

See the [release readiness audit](docs/RELEASE_READINESS.md) for verification results and remaining production gates, and [Privacy](PRIVACY.md) for data and publishing boundaries.

## Get started

For a **fresh Ubuntu server**, copy the matching StackJetty installer bundle to the server. From the directory containing the bundle, run:

```bash
sudo bash stackjetty-install.sh
```

The installer prompts for your dashboard URL, installs missing system packages, and starts StackJetty as a systemd service. Follow its instructions to create the administrator in your browser. See the [Ubuntu installation guide](docs/INSTALL.md#one-command-install-from-a-bundle) for obtaining or building the bundle and verifying it before installation.

For **local development**, open **Code** on this repository's GitHub page. Copy the clone URL into your Git client, use **Open with GitHub Desktop**, or choose **Download ZIP** to try the app without Git history. Then follow the [local development guide](docs/LOCAL_DEVELOPMENT.md) for your operating system.


## Documentation

| Guide | Contents |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | Setup, dashboard editing, discovery, import, access, backups, and Jellyfin. |
| [Security and remote access](docs/SECURITY.md) | Audit findings and Cloudflare Access deployment checklist. |
| [Ubuntu installation](docs/INSTALL.md) | Build a release, install with systemd, configure HTTPS, and back up or recover a deployment. |
| [Local development](docs/LOCAL_DEVELOPMENT.md) | Build, test, and run on Linux, macOS, or Windows. |
| [Service port catalog](docs/HOMELAB_PORTS.md) | Web ports used by discovery and how StackJetty chooses a service name. |
| [Architecture and API](ARCHITECTURE.md) | Application layout, data model, authorization, and API reference. |
| [Contributing](CONTRIBUTING.md) | Development workflow, verification, and documentation requirements. |
| [Changelog](CHANGELOG.md) and [roadmap](docs/DEVELOPMENT_STATUS.md) | Implemented changes, remaining work, and release milestones. |

# Development status

Nexus Dashboard is a development preview. The [requirements audit](REQUIREMENTS_AUDIT.md) tracks the original scope in more detail. See the [changelog](../CHANGELOG.md) for implemented changes.

## Available in the preview

- Setup token, administrator account, editor and viewer accounts, and shared read-only access.
- Tile editing with searchable categories and tags, plus a review step for imports.
- Administrator-approved mDNS and web discovery with routed private subnet/CIDR scopes, exclusions, custom ports, profiles, cancellation, scan comparisons, and editable import/update review.
- JSON tile export, reviewed import/update, named configuration snapshots with restore, user groups and per-tile permissions, host and service inventory, and a server-configured Jellyfin activity count.
- Local build and API tests, native Ubuntu staging, and a systemd first-install script.

The Ubuntu integration preview has exercised sign-in, tile edits and imports, discovery, tag filtering, mobile-width navigation, SQLite migration, and Jellyfin playback counts against a fixture. The native installation guide describes the systemd workflow. Systemd installation, reboot checks, and supported upgrade and rollback still need end-to-end verification.

## Roadmap

| Area | Remaining work |
| --- | --- |
| Ubuntu installation | Verify systemd installation, reboot, upgrade, and rollback. Publish verified release artifacts and then build the one-line installer. |
| Dashboard experience | Add further layout controls and tile types. Light, dark, and system themes and card density preferences are available. |
| Discovery | Add more discovery sources and optional schedules. |
| Live integrations | Add supported integrations beyond Jellyfin. |
| Access | Add multiple dashboards, dashboard-specific permissions and passwords, and richer account management. |
| Operations | Add full-instance backup and restore workflows, diagnostics, and update management. |

## Latest Ubuntu validation

On 2026-11-13, the visible browser smoke test verified live discovery through completion (10,922/10,922 checks, 32 results while test instances ran), cancellation, profiles, import/update review, role/group access, shared access, tile editing, configuration rollback/forward, JSON export/upload preview, preferences, and mobile administration. Local build/API/UI checks and the automated browser suite against a disposable Ubuntu backend passed. The existing preview on port 3000 was backed up and updated with its 19 tiles preserved. See [UI audit evidence](UI_AUDIT.md#ubuntu-verification---2026-11-13) for the tested paths and limits. The instance remains a staged development preview, not a verified systemd installation.

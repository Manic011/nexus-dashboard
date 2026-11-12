# Development status

Nexus Dashboard is a development preview. The [requirements audit](REQUIREMENTS_AUDIT.md) tracks the original scope in more detail. See the [changelog](../CHANGELOG.md) for implemented changes.

## Available in the preview

- Setup token, administrator account, editor and viewer accounts, and shared read-only access.
- Tile editing with searchable categories and tags, plus a review step for imports.
- Administrator-approved mDNS and web discovery with site-based naming and duplicate handling.
- JSON tile export and merge, basic system information, and a server-configured Jellyfin activity count.
- Local build and API tests, native Ubuntu staging, and a systemd first-install script.

The Ubuntu integration preview has exercised sign-in, tile edits and imports, discovery, tag filtering, mobile-width navigation, SQLite migration, and Jellyfin playback counts against a fixture. The native installation guide describes the systemd workflow. Systemd installation, reboot checks, and supported upgrade and rollback still need end-to-end verification.

## Roadmap

| Area | Remaining work |
| --- | --- |
| Ubuntu installation | Verify systemd installation, reboot, upgrade, and rollback. Publish verified release artifacts and then build the one-line installer. |
| Dashboard experience | Add layout controls, themes, and more tile types. |
| Discovery | Add more discovery sources and optional schedules. |
| Live integrations | Add supported integrations beyond Jellyfin. |
| Access | Add multiple dashboards, dashboard-specific permissions and passwords, and richer account management. |
| Operations | Add full-instance backup and restore workflows, diagnostics, and update management. |

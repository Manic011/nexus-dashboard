# Development status

StackJetty is a development preview. The [requirements audit](REQUIREMENTS_AUDIT.md) tracks the original scope in more detail. See the [changelog](../CHANGELOG.md) for implemented changes.

## Available in the preview

- Default tile opening preference and saved per-tile modes for a new browser tab, direct embedding, or Kasm.

- Optional Kasm browser launch inside the service view for administrators. Real provider validation requires a configured Kasm deployment.

- Sandboxed service view and browser-local encrypted login storage for individual accounts. Cross-device vault sync and recovery are outside the current implementation.

- Setup token, administrator account, editor and viewer accounts, and shared read-only access.
- Tile editing with searchable categories and tags, plus a review step for imports.
- Administrator-approved mDNS and web discovery with routed private subnet/CIDR scopes, exclusions, custom ports, profiles, cancellation, scan comparisons, and editable import/update review.
- JSON tile export, reviewed import/update, named configuration snapshots with restore, user groups and per-tile permissions, host and service inventory, and a server-configured Jellyfin activity count.
- Local build and API tests, native Ubuntu staging, and a systemd first-install script.

The Ubuntu integration preview has exercised sign-in, tile edits and imports, discovery, tag filtering, mobile-width navigation, SQLite migration, and Jellyfin playback counts against a fixture. The native installation guide describes the systemd workflow. Dedicated-account systemd installation, preserved-state adoption, service restart, and installed-service browser writes/discovery have passed. Actual reboot, supported application upgrade, and release rollback still need end-to-end verification.

## Roadmap

| Area | Remaining work |
| --- | --- |
| Ubuntu installation | The one-command bundle is available for private transfer. Verify a clean-host privileged bootstrap, actual reboot, application upgrade, and release rollback. Dedicated-account service installation and restart pass. |
| Dashboard experience | Personal layouts support custom placement, column count, tile widths, responsive previews, category arrangement, and category and tag highlights. Themes and card density are available. Further tile types remain planned. |
| Discovery | Add more discovery sources and optional schedules. |
| Live integrations | Add supported integrations beyond Jellyfin. |
| Access | Add multiple dashboards, dashboard-specific permissions and passwords, and richer account management. |
| Operations | Add scheduled/encrypted backups, broader recovery compatibility, diagnostics, and update management. Operator database backup/recovery is available. |

## Latest validation

See the [security audit and remote access guide](SECURITY.md) for the code review, runtime security baseline, and remaining checks before a deployment is made accessible through Cloudflare.

The one-command installer bundle was verified on Ubuntu x86-64 without sudo. Verification checks the embedded archive, runtime, and required application files without changing the running service. The privileged bootstrap on a clean host is still open.

The release audit adds direct API permission checks, group revocation and snapshot recovery checks, and consistent database backup/recovery with session revocation. Local and Ubuntu API/recovery tests and desktop/mobile browser regressions pass. Visible Ubuntu browser checks confirm recovered credentials, group access, and snapshots. Host and network identifiers are intentionally omitted from published records. See [release readiness](RELEASE_READINESS.md) for the privileged deployment status and remaining production gates.

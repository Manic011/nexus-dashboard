# Development status

StackJetty is a development preview. The [requirements audit](REQUIREMENTS_AUDIT.md) tracks the original scope in more detail. See the [changelog](../CHANGELOG.md) for implemented changes.

## Available in the preview

- Administrator diagnostics for sampled availability, host information, and network throughput. The separate SSH workspace supports concurrent Linux statistics, SFTP file management, and interactive shells. SSH supports first-connection host key review, password and private-key authentication, browser-local encrypted saved passwords, and private localhost access through a workstation SSH tunnel. Dashboard sessions time out after 15 minutes of inactivity and close their SSH connections.

- Default tile opening preference and saved per-tile modes for a new browser tab, direct embedding, or Kasm.
- SSH machine inventory editing, groups and search, and bulk editing, connection, and disconnection.

- Optional Kasm browser launch inside the service view for administrators. Real provider validation requires a configured Kasm deployment.

- Sandboxed service view and a unified browser-local vault for each account's service logins and SSH passwords. Cross-device vault sync and recovery are outside the current implementation.

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
| Dashboard experience | Personal layouts support custom placement, tile widths, responsive previews, category labels, order and dividers, and category and tag highlights. Themes and card density are available. Further tile types remain planned. |
| Discovery | Add more discovery sources and optional schedules. |
| Live integrations | Add supported integrations beyond Jellyfin. |
| Access | Add multiple dashboards, dashboard-specific permissions and passwords, and richer account management. |
| Operations | Diagnostics and operator database backup/recovery are available. Add scheduled/encrypted backups, broader recovery compatibility, and update management. |

## Latest validation

The LAN HTTP and HTTPS listeners passed an Ubuntu integration check using a test certificate. The check verified shared tile state, independent login cookies, rejection of wrong origins and replayed session tokens, and the SSH credential transport restriction. Both live LAN listeners were also reachable from the workstation, with certificate validation enabled on HTTPS.

November 15, 2026: The local production build, all eight automated API tests, and all three browser scenarios passed. The eight API tests and the diagnostics and SSH browser scenario also passed against a disposable Ubuntu instance. See the [UI audit](UI_AUDIT.md) for the tested flows and limits.

Service monitoring retries a failed HEAD check with GET. It distinguishes unverified certificates from service failures and omits inconclusive observations from availability. The diagnostics API tests passed locally and on Ubuntu.

See the [security audit and remote access guide](SECURITY.md) for the code review, runtime security baseline, and remaining checks before a deployment is made accessible through Cloudflare.

The one-command installer bundle was verified on Ubuntu x86-64 without sudo. Verification checks the embedded archive, runtime, and required application files without changing the running service. The privileged bootstrap on a clean host is still open.

The release audit adds direct API permission checks, group revocation and snapshot recovery checks, and consistent database backup/recovery with session revocation. Local and Ubuntu API/recovery tests and desktop/mobile browser regressions pass. Visible Ubuntu browser checks confirm recovered credentials, group access, and snapshots. Host and network identifiers are intentionally omitted from published records. See [release readiness](RELEASE_READINESS.md) for the privileged deployment status and remaining production gates.

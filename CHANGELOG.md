# Changelog

## [Unreleased]

- Added a browser-wide tile opening preference and per-tile overrides for a new tab, the embedded browser, or Kasm. Tile backups and snapshots carry the override.

- Added an optional Kasm remote browser action for administrators. The remote browser opens the saved tile inside Nexus.

- Expanded the embedded service view and restored service-origin cookie and storage access for apps such as Proxmox. Nexus continues to reject framing of its own pages.

- Added an embedded service view that opens directly from tile titles and a browser-local encrypted vault for individual accounts.

- Raised the minimum Node.js version and Ubuntu bundle runtime to 24.22.3, the November 2026 security release.
- Added a server-side network discovery switch, blocked browser plugin objects with CSP, and documented the security audit and Cloudflare Access deployment requirements.

- Added a one-command Ubuntu installer bundle with dependency checks, archive verification, systemd setup, and browser onboarding instructions.

- Removed the repository URL placeholder from the README, moved workstation commands into a local development guide, and separated Ubuntu deployment steps by where they run.

### Release readiness and privacy

- Fixed portable backup validation leaving WAL sidecars that could block a dedicated service account after ownership transfer.
- Added consistent operator-only database backup and fresh-directory recovery with integrity/schema validation and restored-session revocation.
- Added direct API permission and recovery regression tests, including restricted editor access, group revocation, stale snapshot rejection, and full database recovery.
- Hardened native installation checks, deliberate state adoption, startup health verification, and service isolation.
- Added a release audit, privacy guide, CI release-input checks, and generic documentation/test examples. Private deployment artifacts and original-history backups are excluded from Git and distribution.

### Discovery and import refinements

- Added routed private IPv4 subnet scanning with CIDR targets, independent exclusion rows, port ranges, target deduplication, and a 4096-address scope limit.
- Added named server-side scan profiles, explicit cancellation with partial-result review, and complete-scan comparisons for added, changed, and missing URLs.
- Added import-result filtering, explicit updates for existing URLs, editable descriptions, and an accessible category dropdown with a create option. Existing-tile updates preserve IDs and permissions and reject stale previews.
- Fixed filtered rows disappearing when their suggested names are edited. Added API and browser regression coverage for the refined workflow.

### Added

- Token-gated administrator setup, login, and logout.
- Persistent application tile management, category grouping, and search.
- Native Ubuntu service definition and automated API lifecycle test.
- Administration page with system information, JSON tile export, backup merge, and reviewed bulk import from service addresses.
- Editor and viewer accounts, shared dashboard password, and administrator-triggered mDNS discovery.
- Broadened discovery to check common web ports alongside mDNS and reorganized Administration into four sections with a dedicated import review.
- Added a 50-service port catalog, service suggestions and page-title recognition, and live Jellyfin playback counts.
- Discovery names tiles from application metadata or page titles and uses catalog names only when the site does not identify itself.
- Discovery follows immediate same-site page redirects, recognizes more device interfaces, and filters redirect duplicates and common non-dashboard responses.
- Added persistent tags, category and tag filters, a refreshed card layout, and editable import previews.

### Documentation

- Expanded the README and added detailed usage, installation, API, and contribution guides.
- Added a documentation checklist for future changes and documented the planned one-line Ubuntu installer.
- Added browser-local appearance preferences, refreshed card spacing, reusable tag suggestions, and easier mobile import review.

- Improved tile editor focus, mobile account management, and loading and import feedback. Added a browser UI audit to CI.
- Fixed the tile editor category menu so it lists all categories and offers an explicit create option.
- Added discovery history, user groups and per-tile access, saved configuration snapshots with restore, and host and service inventory details.
- Added visible discovery progress, naming evidence, and duplicate labels, plus restore diffs and effective tile access previews.
- Discovery scans now finish checking the full selected range, with progress and final coverage counts.
- Discovery supports explicit IPv4 addresses and ranges, exclusions, and custom web ports with a scope preview.
- Added editable discovery presets for IP addresses, exclusions, and ports.
- Grouped discovery options into separate sections with repeatable address, exclusion, and port fields.

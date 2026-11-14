# Changelog

## [Unreleased]

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

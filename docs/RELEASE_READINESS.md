# Release readiness audit

For Internet-facing deployment gates and the Cloudflare Access checklist, see [Security audit and remote access](SECURITY.md).

Audit date: 2026-11-14. Scope: the current development preview, its permission model, recovery tools, Ubuntu service installation, browser workflows, and distributable-file privacy.

## Decision

The application remains a **development preview**, not a generally available production release. Permission and recovery checks pass. The dedicated systemd deployment, restart, and browser checks pass. A passing application smoke test does not establish host security, reboot recovery, or a supported upgrade policy.

## Verification matrix

| Gate | Evidence | Status |
| --- | --- | --- |
| Build | TypeScript check and production Vite build | Passed |
| Dependencies | npm audit, including development dependencies | No known vulnerabilities reported at audit time |
| Anonymous access | Tiles, exports, and administrator data require a session; source/config URLs are not served as static files | Passed API tests |
| Role enforcement | Viewers cannot write; editors cannot invoke administration; hidden restricted tiles cannot be edited or deleted directly | Passed API tests and visible Ubuntu browser checks |
| Group access | Group membership grants visibility; removing the group removes visibility; snapshot restore reinstates the group and effective access | Passed API tests and visible Ubuntu browser checks |
| Session revocation | Account removal ends sessions; offline database recovery clears all restored sessions | Passed API tests; recovery verified in the visible browser |
| Import/update | Duplicate handling, explicit updates, stable IDs and permissions, stale-revision rejection | Passed API/browser coverage |
| Configuration snapshots | Restore diff, stale-preview rejection, automatic safety snapshot, group/rule preservation | Passed API/browser coverage |
| Database backup/recovery | Consistent SQLite backup, integrity and schema checks, protected output, refusal to overwrite a populated directory, credentials and configuration restored | Passed locally and on Ubuntu; recovered instance exercised in the browser |
| Native service | Dedicated service user, protected configuration and state, startup health check, restart, and preserved data | Passed on Ubuntu after the portable-backup correction; installed-service browser CRUD and discovery passed |
| Browser regression | Desktop/mobile dashboard, editor, import, discovery controls, users, permissions, snapshots, preferences, and system page against an Ubuntu backend | Passed |
| Release privacy | Operator-specific repository references and network examples removed; generic privacy checks added to CI | Current files and reachable local history sanitized; guarded publication pending |
| Distribution | Explicit staging allowlist and production dependencies; no local state, environment files, screenshots, private keys, or Git database in the bundle | Allowlist staged; operator-reference and archive-owner scans pass; final checksum recorded with the preview artifact |

## Fixes made during the audit

- Added an operator-only database backup/recovery tool. It validates schema and SQLite integrity, finishes backups as portable single files, and restores to a new directory, preserving the current state for rollback. Recovery revokes restored browser sessions.
- Tightened the installer to require the supported Node runtime, reject external or top-level directory symlinks, import existing state deliberately, and check startup health.
- Extended systemd isolation while retaining the address families needed for HTTP, mDNS, and interface enumeration.
- Added direct API role and permission regression coverage, database recovery tests, portable script checks, and automated release-input privacy checks.
- Corrected a portable-backup hazard found during the service trial: WAL-mode backup validation could leave sidecars owned by the backup operator. The final tool switches the completed backup to DELETE journal mode before ownership transfer; regression tests assert that neither WAL nor shared-memory sidecars remain.
- Allowed a longer initial navigation budget in remote browser tests after a cold remote navigation exceeded the local-only timeout. The subsequent full remote run passed.
- Removed operator-specific examples from project files. Real deployment logs, screenshots, state files, and original-history backups stay outside the repository.

## Remaining gates before a stable release

1. Verify actual boot startup in a scheduled reboot window; enabled-at-boot alone is not a reboot test. Dedicated-account migration, restart, filesystem restrictions, state preservation, discovery, and normal browser writes have passed.
2. Confirm that the host OS receives current security maintenance. Use a supported Ubuntu LTS release or appropriately maintained extended support. Host-specific version, subscription, addresses, and machine details are intentionally excluded from this public-facing report.
3. Validate HTTPS/reverse-proxy deployment with a trusted certificate before exposing credentials beyond a trusted development network. Secure-cookie behavior depends on the configured HTTPS origin.
4. Test a supported application upgrade and rollback procedure, not just initial installation and database recovery. The first-install script deliberately refuses to overwrite an installation.
5. Decide the project release license and distribution policy. Include required third-party notices and verify runtime provenance/checksums before publishing downloads.
6. Complete the sanitized-history push, verify hosted CI, and review GitHub-visible metadata and retained diffs/caches. Rewriting branches does not erase external clones, GitHub account ownership, issue author attribution, or all cached commit views.
7. Further work remains in the original product scope, including multiple dashboards, dashboard-specific passwords, password recovery, MFA, additional integration adapters, scheduling, IPv6, and update management. These must not be advertised as implemented.

## Privacy boundary

This report contains generalized test outcomes, not a deployment inventory. Source and artifacts must not contain operator account names, real network examples, hostnames, user paths, credentials, database files, private screenshots, or deployment logs. Runtime operator configuration remains private and is preserved; administrators will still see their own host and service inventory. See [Privacy](../PRIVACY.md), [the UI audit](UI_AUDIT.md), and [installation/recovery](INSTALL.md).

## Installed-service verification

The first service trial exposed the portable-backup sidecar issue described above. The preview was recovered while the fix was tested. The corrected migration retained both the previous installed state and a fresh database backup, preserved the account/tile/group/permission/discovery tables, verified database/sidecar ownership, and passed startup and restart health checks.

The service is active and enabled under the dedicated non-root account with no automatic restart failures observed after correction. Configuration is protected; the account cannot write application code or read the environment file directly. The visible browser verified the existing session, temporary tile create/edit/delete, preservation of original tiles, source-interface enumeration, a completed self-scan, and all administration sections. Sensitive hostnames, addresses, process IDs, account names, and backup locations are kept only in private operational records.

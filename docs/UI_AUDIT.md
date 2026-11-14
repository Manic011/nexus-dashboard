# UI audit

Review every new or changed screen before merging. Apply the same review to dialogs, menus, and admin sections.

- Check desktop and narrow mobile layouts, with long names, empty lists, and enough content to scroll.
- Check spacing, clipping, contrast in light and dark themes, and readability at browser zoom.
- Navigate with the keyboard. Verify visible focus, labels, dialog entry and return, Escape, and form submission.
- Check dropdown labels, default values, browser autofill, reusable tags, and category suggestions.
- Check loading, empty, success, and failure states. Confirm that rejected saves preserve the user's input.
- Exercise each affected role. Verify destructive actions require confirmation and access changes take effect.
- Check preference persistence and sign-out. Record any difference between device-local and account-wide settings.
- Add browser coverage for new high-value flows in `test/ui-audit.mjs`. Record manual checks and any remaining gaps in the pull request.

## Current coverage

The Chromium service-view check verifies opt-in frame loading at mobile width, a new-tab link, vault encryption and persistence, wrong-password handling, and credential removal.

The Chromium smoke test covers setup and sign-in, the dashboard, tile creation and editor focus, delete cancellation, tag filtering, persisted appearance settings, manual import review, backup download, system information, and viewer creation and removal. It checks horizontal overflow at 320 pixels. Real network scanning and assistive-technology review are separate manual checks.

Run from the repository root:

```sh
npm ci
npm run build
npx playwright-core install chromium --only-shell
npm run test:ui
```

On Linux CI, install the browser dependencies with the `--with-deps` option. The default test starts a local instance with a temporary database. For Ubuntu integration, set `NEXUS_UI_TEST_URL` and `NEXUS_UI_TEST_TOKEN` for a fresh disposable instance. The test creates accounts and tiles. [Playwright browser installation](https://playwright.dev/docs/browsers)

The browser suite also checks discovery progress and source labels using controlled responses, restore diffs, individual grants, invalid tile input, and the Jellyfin activity count with a fixture.

## Ubuntu verification - 2026-11-13

The discovery/import refinement was exercised in the visible in-app browser against a disposable Ubuntu-hosted instance, with a separate state directory from the saved dashboard. The same locally built release was then promoted to the existing port 3000 instance after a SQLite backup. The existing dashboard configuration was preserved.

| Area | Result and evidence |
| --- | --- |
| Discovery planning | Rejected an off-subnet public target; accepted multiple private CIDR rows, exclusions, duplicate ports, and a /32. Effective preview correctly reduced the test to one host/port check. |
| Profiles | Saved, loaded, and ran a named profile. Loading restored all settings and required scope review and authorization. |
| Live scan | A full default-scope scan completed every planned check while disposable test instances were running. Deployment-specific inventory counts are retained only in private operational records. |
| Cancellation | Stopped a scan before completion; the stopped result and discovered services were available for review. |
| History and comparison | Reopened recorded results; repeated an identical complete scope and verified the comparison panel with zero added/changed/missing URLs. Nonzero change categories have not been separately exercised in the visible browser. |
| Import/update | Imported a live-discovered service with a new category and tags; rescanning marked it existing and left it unselected. Explicit update succeeded. The API test verifies stable IDs, preserved permissions, and rejection of stale revisions. |
| Filtering | Verified result filtering, hidden selections, and editing a filtered name without losing its row. The browser test found this issue and the final release fixes it. |
| Tile editor | Created/edited a tile and category, reused a suggested tag, canceled deletion, then deleted the disposable tile. Search and category filtering showed the expected empty state. |
| Users and access | Created viewer/editor accounts and a group. A group grant allowed viewing; removing it hid the tile. Saved an individual grant. Shared sign-in hid the restricted tile. An editor could add a tile but could not see restricted tiles or administration. |
| Backups | Downloaded tile JSON, uploaded it for duplicate review, saved a named configuration snapshot, inspected the removal diff, restored backward, then restored the automatic safety snapshot forward. |
| Preferences | Light/compact settings persisted across reload. Verified the dashboard and administration at 375 pixels with no horizontal overflow; default viewport restored afterward. |
| System | Confirmed Ubuntu runtime v24.14.1, schema 4, host/kernel/memory/uptime values, and tile access inventory. CPU model is unavailable in this container. |
| Regression suite | Local build, API tests, and Chromium desktop/mobile flows passed. The same browser regression suite passed against a fresh Ubuntu-hosted backend. Initial sandbox connection denial and a first remote navigation timeout were resolved before rerunning. |

This is a smoke test, not exhaustive security or accessibility certification. Screen reader behavior, systemd installation/reboot, real Jellyfin credentials, scheduled scans, IPv6, arbitrary HTTPS port detection, and nonzero scan-comparison changes remain outside this manual verification. The local browser suite covers Jellyfin against a fixture; real integration credentials were not configured for this run.

## Release audit - 2026-11-14

A fresh disposable Ubuntu instance was used for the current release audit. Visible browser checks verified role-based administration denial, direct admin-API denial for a viewer, group removal revocation, snapshot restoration of deleted groups and effective access, and offline database recovery. Recovery forced a fresh sign-in; existing account credentials and group visibility worked afterward, and saved snapshots survived.

All five API/recovery tests passed both locally and on Ubuntu. The desktop/mobile browser regression suite passed locally and against an Ubuntu backend. The privileged service migration, restart, and dedicated-account browser checks passed and are recorded in the [release readiness audit](RELEASE_READINESS.md). Real deployment screenshots and host/network details are not repository assets.

After service installation, the existing browser session remained usable. A temporary tile was created, edited, and deleted, and the original tile display matched the pre-test state. Interface enumeration and a live self-scan completed under the dedicated service account. Users, Backup, and System loaded successfully. Recovery archives, journal output, screenshots of real data, host identities, and network information are excluded from Git and releases.

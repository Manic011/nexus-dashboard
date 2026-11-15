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

The remote browser regression uses a fixture provider to verify that the workspace renders in the same StackJetty tab and that switching back restores the direct view. Check real Kasm authentication and browser delivery on a configured provider.

The Chromium service-view check verifies immediate frame loading at mobile width with a service that requires cookie and storage access, dismissal and focus return, vault encryption and persistence, wrong-password handling, and credential removal.

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

The personal layout regression checks drag and keyboard placement, tile width, rejection of a move beyond the grid, persistence on reload, search, mobile reflow, cancel/reset, and separate administrator and viewer layouts. It passed against a disposable Ubuntu instance. The live service was verified to serve the tested frontend assets and report healthy after the update.

The category and tag regression verified combined highlights, continued access to tiles outside the highlights, filtering from a custom tile’s category, and packing different categories onto separate rows. The browser suite passed on Ubuntu and the live service served the verified build.

The layout preview regression compared the position, width, and height of a preview card to its saved dashboard card at desktop and 320-pixel widths. It also checked grouped previews and verified that tile launch controls cannot receive focus in the preview. The browser suite passed on Ubuntu, and the live service served the verified build.

The category settings regression verified personal names and category order in the custom grid and grouped preview. It enabled dividers, saved, and reloaded to confirm that the dashboard kept the labels and order. The browser suite passed on Ubuntu, and the live service served the verified build.

Browser tests on Ubuntu verified that grouped layouts open as editable category sections and retain tile order and full-row widths after a reload. At 320 pixels, they confirmed that a custom-grid card has the same geometry while editing and on the saved dashboard. The live service served the verified build.

The Ubuntu browser suite verified dragging a tile to another category, canceling that draft, and saving a category change through the selector. After reload, the tile editor showed the new category. API tests covered access checks, retries, and rollback when a batch contains a conflicting change.

The Ubuntu browser suite also verified drops on the empty end of a category divider, on unused space in a grouped section, and on a divider with one category in the custom grid.

CI run 43683126684 exposed a first-render race in the tile editor’s Tags field. Saved tags now initialize with the editor state. The browser sign-in test also uses an exact Applications heading to avoid matching the empty-state heading. The browser suite passed locally and against Ubuntu after these changes. The live frontend was updated and its health endpoint verified.

The grouped layout regression drags an entire category by its header handle, checks that its tile moves with it, reorders with the arrow keys, and verifies preview and saved order after reload. It passed locally and against an isolated Ubuntu instance.

## Diagnostics verification

The November 15, 2026 documentation smoke test ran the full local Chromium suite and all eight API tests locally and on Ubuntu. The Ubuntu-hosted browser scenario exercised tile opening preferences, uptime sampling, host metrics, network transfers, first-use SSH key approval, saved password locking and reuse, concurrent workspaces, shell input, file actions, and independent disconnect. Screenshots were captured separately in a disposable local browser with fictional tiles, a fixture SSH server, and sample files. The download exercise verified the browser event and payload. It did not verify a file saved to disk.

The service monitor regression verified that a 501 response to HEAD can recover via GET, that a persistent HTTP 503 still counts as unavailable, and that certificate verification errors are distinct from timeouts and refused connections. The diagnostic browser test passed locally, and the API regressions passed on Ubuntu.

The SSH workspace browser test passed locally and against a disposable Ubuntu backend. It opened two sessions to one host, returned to the first shell after visiting the dashboard, and verified independent disconnect. It also exercised folder creation, copy, paste, rename, cut, confirmed deletion, file upload, and the download event and payload. The headless environment did not verify the saved download on disk. API tests verified that sign-out and an expired idle deadline close the underlying SSH shell. The live Ubuntu service passed its health and asset checks after the schema 6 update.

The first-connection host key flow passed locally and against a disposable Ubuntu backend. The browser added a machine with no pasted fingerprint, showed the key for approval, opened the password form, and connected. API checks rejected password sign-in before approval and rejected replacing an already trusted key. The installed Ubuntu service passed its health and asset checks after deployment.

The SSH password regression passed locally and against a disposable Ubuntu backend. It verified the default password method, encrypted browser storage, persistence after reload, rejection of an incorrect master password, password removal and replacement, reconnecting with a saved password, Linux statistics, SFTP preview, shell input, and removal of the current browser's saved vault when deleting the machine. The full local browser suite also passed its dashboard and administration flows. All seven API tests passed locally and on Ubuntu, including password/PAM authentication, host-key and session checks, rejection of plain LAN HTTP credentials, and rejection of forwarded-header or missing-origin attempts to use the localhost exception.

The local browser suite exercised uptime checks, enabling and pausing monitoring, host metrics, the network transfer test, machine registration, SSH authentication, Linux statistics, SFTP file listing and preview, terminal input, mobile width, disconnect, and machine removal. The diagnostic browser test also passed against a disposable Ubuntu instance. Its temporary loopback SSH server executed statistics and shell commands on Linux. API tests checked host-key rejection, session isolation, duplicate shell input, viewer denial, and the HTTPS/localhost credential requirement.

The live Ubuntu deployment preserved the saved configuration and now collects observations for its configured services. A visible Chrome check verified host statistics, network test results, and the HTTP credential-entry restriction. Real operator SSH credentials and a public HTTPS tunnel remain deployment-specific checks.

The diagnostic navigation regression passed against Ubuntu. It opened Diagnostics directly from the main header, verified embedded service opening and focus return, checked new-tab links for a global preference, and verified that a per-tile embedded override still opens the service view. The URL and title both use the tile launch behavior. Viewer navigation checks continue to hide Diagnostics.

The installed Ubuntu service was checked in visible Chrome. Diagnostics opened from the main header, a saved service opened in the embedded view, and closing it returned focus to its diagnostic link.

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

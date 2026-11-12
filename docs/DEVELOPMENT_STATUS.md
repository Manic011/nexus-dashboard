# Development status

Phase 1 is underway. The first slice supports a single administrator and categorized application links. The API lifecycle test covers setup, origin checks, login, persistence across a restart, and tile CRUD.

| Phase | Milestone |
| --- | --- |
| 0 | Establish the private GitHub remote, CI, and issue tracking |
| 1 | Install on Ubuntu, exercise browser flows, and finish MVP documentation |
| 2 | Dashboard editing, layout controls, themes, and accessibility |
| 3 | Review-based service discovery and import |
| 4 | Live integrations with server-side credential storage |
| 5 | Multiple accounts, roles, and dashboard access |
| 6 | Backups, restore, administration, and upgrades |
| 7 | Operational testing and release preparation |

## Verification

The local production build and API lifecycle test passed. Chromium exercised first-run setup, sign-in, tile CRUD, search, and sign-out over the LAN against an isolated Ubuntu staging instance. The staged process was stopped after testing. The native systemd installation requires an administrator to run the staged installer. GitHub repository creation is complete. Publishing the local Git history requires Git authentication.

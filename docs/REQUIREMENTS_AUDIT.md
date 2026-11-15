# Build requirements audit

This matrix follows sections 1–26 of the master instructions. Partial means that the remaining items in that row are open. The current product is an early preview.

| Section | Implemented | Open |
| --- | --- | --- |
| 1. Product vision | Browser setup and self-hosted launcher | Integrated monitoring, multiple dashboards, polished workflows and production readiness |
| 2. GitHub | Private repository with source history, local Git, CI configuration, changelog and roadmap issues | Routine CI review, milestones, project board, branch protection, repository security settings and release automation |
| 3. Environment | Local build, verified SSH, native systemd installation, dedicated account and restart checks | Actual reboot checks, HTTPS and optional Compose |
| 4. Architecture | React, Vite, TypeScript, REST and transactional SQLite migrations | OpenAPI, background jobs, integration adapters, event streams and persistence abstraction |
| 5. UX | Responsive launcher, first-run account creation, tile forms, and personal layouts with adjustable columns, spacing, and tile widths | Guided onboarding, richer editing, and full accessibility verification |
| 6. Tiles | Categorized web links with names and descriptions | Icons, bookmarks and other tile types, metrics, statuses, sizes, ordering and advanced settings |
| 7. Discovery | Operator-selected source interface, mDNS and web identification, private multi-subnet CIDR/range targets, exclusions, custom ports, profiles, cancellation, comparisons, and reviewed import/update | SSDP, wider service signatures, hostname enrichment, Docker/Proxmox inventory, more import formats, scheduling and notifications |
| 8. Integrations | Jellyfin active-stream counts | Proxmox, UniFi, Home Assistant, Docker and further adapters, credential management and polling |
| 9. Access | Administrator, editor, viewer, shared viewer password, user groups, per-tile user/group grants, effective-access preview, session expiry and revocation on removal | Multiple dashboards, dashboard-specific passwords and ACLs, public mode, profile fields, password changes/recovery, Argon2id migration, TOTP and audit events |
| 10. Themes | Responsive dark/light/system themes and card density | Additional theme options, templates, portability and customization |
| 11. Search | In-dashboard search over title, URL, description and category | Global navigation and command palette |
| 12. Monitoring | Process health, host/runtime/kernel/CPU/memory/uptime information, schema and tile inventory | System metrics, service health, history and status widgets |
| 13. Administration | Users/groups, tile access, host/service inventory, discovery history/profiles, JSON import/update, and configuration snapshots/restore | Settings, per-dashboard management, integrations, themes, security settings, updates, logs and diagnostics |
| 14. Backups | Versioned tile JSON export and reviewed merge/update; local named configuration snapshots, restore diffs, and automatic pre-restore snapshot | Environment/application restore automation, encryption, scheduled backups, compatibility tooling and Heimdall migration |
| 15. Updates | Local build and manual staging | In-app version checks, verified update packages, migration and rollback workflows |
| 16. Security | Salted password hashes, session digests, role checks, origin validation, headers and request limits | Argon2id migration, audit trail, finer throttling, integration secret handling and comprehensive security testing |
| 17. Reliability | Local persistence and bounded mDNS operation | Load tests, caching, retries, scheduled work and fault recovery verification |
| 18. QA | Local build and API tests, Ubuntu browser checks | Wider unit, browser, security, integration, upgrade and recovery coverage in CI |
| 19. Docs | README, user guide, contributor checklist, architecture and API reference, changelog, install and troubleshooting guide | Verify upgrade and rollback instructions end to end |
| 20. Installation | One-command Ubuntu installer bundle, service installation, deliberate state adoption, startup/restart checks and operator database recovery | Clean-host bootstrap verification, supported release upgrade/uninstall, actual reboot, and optional Compose |
| 21. Phases | Initial launcher with slices of access, discovery and administration | Finish the phased acceptance criteria before declaring a release |
| 22. Workflow | Local development, local commits, GitHub publishing and Ubuntu validation | routine branch/PR/CI verification and reproducible deployment automation |
| 23. Quality | Working preview flows and persistent data | Production hardening, usability testing and release readiness |
| 24. Continuity | AGENTS.md, development status and GitHub issues | Keep issues, acceptance criteria and deployment records synchronized |
| 25. Initial execution | Architecture, local repository, private remote, roadmap issues, initial build and staging | Complete the first release, CI and service verification |
| 26. Local/remote | Local source and Git, strict SSH verification, Ubuntu integration checks and dedicated systemd deployment | Actual reboot and supported release upgrade/rollback |

## Acceptance criteria for the next access and discovery work

- Multiple dashboards must enforce membership and editing rights on the server. Test that accounts assigned to one dashboard cannot read or change another dashboard through the API. Add password-protected sharing scoped to one dashboard.
- Add discovery methods independently. Every run must show its scope, require explicit authorization, and produce a reviewable list. Verify each source with representative service fixtures on Ubuntu.
- Backups must restore dashboards and access rules together. Test rollback against an existing database before shipping updates.

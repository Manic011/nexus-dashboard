# Privacy and release hygiene

StackJetty ships with no preconfigured users, dashboards, hostnames, network targets, or deployment credentials. Setup creates local accounts; operators add service links and authorize discovery. Examples use generic private addresses or reserved example domains and do not describe a real deployment.

## Runtime data

Accounts, password hashes, session digests, tiles, groups, permissions, profiles, history, and configuration snapshots live in the local SQLite state directory. Appearance settings and personal tile layouts are stored in the current browser. Layout preferences include tile IDs and destination URLs so StackJetty can match placements to saved tiles. Administrators can inspect their own host information and configured services. Other roles receive only the tiles allowed by their permissions. A tile grant controls StackJetty visibility and does not grant access to the linked service itself.

StackJetty contains no application analytics or telemetry exporter. GitHub reports repository traffic and release asset downloads through its own platform. Authorized discovery contacts the selected network targets and local multicast services. A configured Jellyfin integration sends its key only to the operator-configured base URL. Opening a tile navigates the user's browser to the configured service. Browser and upstream applications have their own privacy behavior.

Opt-in monitoring contacts saved tile URLs and records sampled availability for seven days. SSH machine records contain hostnames, usernames, ports, and trusted fingerprints. Optional SSH passwords are encrypted with a master password and saved in the current browser, scoped to the account and machine. The server uses credentials in memory for the active connection. SFTP uses the remote account's permissions to read and write remote files. StackJetty relays file transfers and terminal traffic without recording their contents in SQLite or backups. These features are restricted to administrators. Full-database backups contain monitoring history and machine metadata.

## Backups and logs

The credential vault lives in browser site storage for an individual StackJetty account. It encrypts service and SSH destinations and login values before storage. The unlocked key stays in browser tab memory until the vault locks. The vault is outside server backups and exports. Copying a service login places it on the device clipboard.

Tile exports contain service URLs and metadata. Database backups contain account hashes and configuration; they can also contain session digests and discovery records. They are sensitive operational files, not release assets. Recovery revokes restored sessions. Protect backups with restrictive filesystem permissions, encrypted storage where appropriate, and a tested retention policy. Back up the protected environment file separately when recovering a complete instance.

Logs can include operational errors and network information. Keep them on the deployment host with operator-only access. Never attach unredacted logs, network scans, account exports, or production screenshots to GitHub issues or releases.

## Publishing checklist

- Run `npm run check:release` and review the staged artifact separately.
- Package only built frontend assets, server code, production dependencies, verified runtime files, deployment scripts, and sanitized documentation.
- Exclude `.git`, environment files, state databases and sidecars, logs, private keys, downloads, browser sessions, and screenshots from real deployments.
- Review Git history, issue content, release assets, workflow logs, and metadata before making a repository public.
- Use generic fixtures for documentation images and tests. Do not copy runtime configuration into examples.
- Remember that repository ownership, issue authorship, external clones, and hosted cached diffs are not removed by changing source files or rewriting a branch. Keep original-history backups private and local.

The automated check is a guard against common leaks, not a guarantee that arbitrary prose or an image contains no identifying information. Manual artifact and history review remains required.

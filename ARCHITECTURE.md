# Architecture and API

## Runtime and storage

When a separate Kasm HTTPS endpoint is configured, the administrator-only remote browser API derives a Kasm launch URL from a saved tile ID. The browser embeds the Kasm client and Kasm handles authentication, browser execution, and session lifecycle. StackJetty stores no Kasm tokens or browser session data and performs no upstream requests for this feature.

The tile service view loads a sandboxed frame directly in the browser. The sandbox gives services on a different origin access to their own cookies and storage, and allows scripts and forms. The browser separates StackJetty from the service. StackJetty blocks itself from being framed through CSP and X-Frame-Options, including after an embedded navigation. The sandbox restricts top-level navigation and popups. A tile opens the frame inside the dashboard, and closing the view unloads it. The credential vault uses versioned AES-256-GCM ciphertext with a fresh IV on each write, a per-vault random salt, and PBKDF2-SHA-256 with 600,000 iterations. The key stays in browser memory while unlocked. Web Locks and a ciphertext comparison prevent simultaneous tabs from overwriting a newer vault. The server has no vault API or database table.

The React interface is built with Vite and served by the Node.js process alongside the TypeScript API. Browser requests share one origin. The backend validates input with Zod and uses prepared statements with Node's built-in SQLite bindings.

SQLite uses WAL mode and transactional migrations tracked with `PRAGMA user_version`. The database stores accounts, session token digests, and application tiles. Tiles have a single category and a JSON array of tags. The migration to schema 3 adds an empty tag array to existing tiles. Schema 5 adds a tile opening mode that defaults to the viewer’s preference. Version 1 JSON exports include the mode and accept older entries without a mode or tags. Older configuration snapshots restore missing modes as **Use my default**.

| Directory | Responsibility |
| --- | --- |
| `src/` | Sign-in, dashboard, editing, administration, and import review. |
| `server/` | Routing, authorization, SQLite, discovery, and Jellyfin. |
| `test/` | Automated API lifecycle and discovery scope tests. |
| `deploy/` | Native Ubuntu first-install script and systemd unit. |

## Authentication and authorization

First-run setup requires a deployment token and creates the administrator. Passwords are salted and hashed using scrypt. Session cookies use HttpOnly and SameSite=Strict, with Secure enabled for HTTPS origins. Session tokens expire after seven days and are stored as SHA-256 digests. Write requests require the configured Origin and the JSON content type. Setup and login share a process-wide throttle of 12 attempts per minute.

Administrators manage accounts and discovery. Editors manage tiles. Viewers and shared-password guests can arrange their personal view of the tiles they can access. Personal tile positions and widths are stored in browser appearance preferences keyed by account. The grid is rendered using the tiles returned by the permissions-filtered API. Removing an account revokes its sessions. Tile permissions apply to access within StackJetty. Linked services enforce their own authentication.

## Discovery and integration

Setting `NEXUS_DISCOVERY=off` disables the discovery, scan planning, interface, and profile endpoints. The administrator system endpoint reports `discoveryEnabled`. Saved scan history and manual imports remain available to administrators.

The administrator selects a server interface. The web discovery route combines mDNS advertisements with bounded HTTP and HTTPS checks of the selected IPv4 targets: a /24 default, or explicit local/private CIDRs, individual addresses, and ranges capped at 4096 unique selected addresses before exclusions. It uses live page evidence first, then the port catalog for suggestions. Recognized unverified certificate names can provide a labeled clue. The browser previews results through the same validation and duplicate checks as a backup import.

Jellyfin receives read-only requests at the configured base URL. StackJetty sends the aggregate active stream count to authenticated clients when a tile matches the base URL. The key is supplied through server configuration.

## HTTP API

Mutation requests use JSON and require the configured `Origin` header. Authenticated routes use the `nexus_session` cookie. Errors return an object with an `error` message.

| Method and route | Access | Purpose |
| --- | --- | --- |
| `GET /healthz` | Public | Check database availability. |
| `GET /api/session` | Public | Report setup, session role, and shared access availability. |
| `POST /api/setup` | Setup token | Create the first administrator using `username`, `password`, and `token`. |
| `POST /api/login` | Public | Start a session using `username` and `password`. |
| `POST /api/logout` | Signed in | End the current session. Send an empty JSON object. |
| `GET /api/tiles` | Signed in | List saved tiles, including IDs and tags. |
| `POST /api/tiles` | Editor or administrator | Create a tile. |
| `PUT /api/tiles/{id}` | Editor or administrator | Update a tile. Omitting tags preserves the existing tags. |
| `DELETE /api/tiles/{id}` | Editor or administrator | Remove a tile. |
| `GET /api/integrations/jellyfin` | Signed in | Return matching tile IDs and the playback summary if configured. |
| `GET /api/admin/users` | Administrator | List user IDs, usernames, and roles. |
| `POST /api/admin/users` | Administrator | Create an editor or viewer using `username`, `password`, and `role`. The `shared` username is reserved for shared viewer access. |
| `DELETE /api/admin/users/{id}` | Administrator | Remove an editor or viewer and revoke their sessions. |
| `GET /api/admin/system` | Administrator | Return runtime, platform, schema version, and tile count. |
| `GET /api/admin/discovery/interfaces` | Administrator | List available server IPv4 interfaces and scan ranges. |
| `POST /api/admin/discovery/web` | Administrator | Combine mDNS and web discovery. Send an interface `address` and `authorized: true`. |
| `POST /api/admin/discovery/mdns` | Administrator | Check mDNS advertisements using a server interface `address`. |
| `GET /api/admin/backup` | Administrator | Download a version 1 tile export. |
| `POST /api/admin/backup/preview` | Administrator | Return new tiles, existing matching entries, duplicate count, and a revision hash. |
| `POST /api/admin/backup/import` | Administrator | Create selected new tiles; explicitly update matching URLs with updateUrls and a preview revision. |

Tile writes accept `title`, `description`, `url`, `category`, and optional `tags`. The example shows the backup envelope used for preview and import:

```json
{
  "version": 1,
  "tiles": [
    {
      "title": "Media library",
      "description": "Movies and television",
      "url": "https://media.example.net/",
      "category": "Media",
      "tags": ["Video", "Family"]
    }
  ]
}
```

Development and deployment instructions are in the [contributor guide](CONTRIBUTING.md) and [Ubuntu install guide](docs/INSTALL.md).

## Discovery profiles, cancellation, comparison, and imports

All endpoints below require an administrator session and the normal Origin checks for mutations.

| Method and route | Contract |
| --- | --- |
| `POST /api/admin/discovery/plan` | Accept `address`, optional comma-separated `range`, `exclude`, and `ports`; return `hosts` count, `ports`, and `checks`. Does not probe targets. |
| `POST /api/admin/discovery/web` | Accept the same scope plus `authorized: true`. Return `version`, up to 500 `tiles`, `found`, completed `checked`, `total`, `cancelled`, `scopeKey`, and nullable `comparison`. |
| `GET /api/admin/discovery/progress` | Return the current process-wide `{progress: {checked,total}}`, or null when idle. |
| `POST /api/admin/discovery/cancel` | Stop scheduling new probes in the process-wide active scan. In-flight work completes; partial results are returned and recorded. |
| `GET /api/admin/discovery/profiles` | List named server-side profiles with `id`, `name`, `address`, `range`, `exclude`, `ports`, and record timestamps. |
| `POST /api/admin/discovery/profiles` | Save those named settings; replace the profile of exactly the same name. Saving does not execute a scan. |
| `GET /api/admin/console` | List groups, tiles with access rules, configuration snapshots, and scan history. |
| `GET /api/admin/scans/{id}` | Return the recorded result for import review, including comparison metadata when available. |

Profiles and scan records use the existing `admin_records` table (schema version 4); no database migration is needed for this release. The last 20 scan records are retained. Profiles do not have automatic retention or deletion yet. Requests and progress live in process memory; restarting loses active work, and reload does not reconnect the UI to the request. Only one discovery request can run at a time.

Web targets are expanded lazily across 48 workers, with bounded individual requests and no overall deadline. Explicit targets beyond the default local subnet must use RFC 1918 addresses. Local interface subnets may also use link-local addresses. HTTP responses are bounded to 16 KiB for identification. The selected source IPv4 address is bound to requests; routed reachability is determined by Ubuntu. mDNS results are constrained to the effective hosts and ports, and advertisements remain local to the selected interface.

Complete scans of identical effective scope compare URL sets with the most recent retained complete, non-truncated result. Comparisons contain `added`, `missing`, and `changed` URL arrays. Changed means title or identification-source changes. Stopped or truncated results do not produce a comparison. Missing URLs never trigger tile removal.

`POST /api/admin/backup/preview` returns a SHA-256 `revision` of the saved tile rows along with `tiles`, `existing`, and `skipped`. Imports accept optional `updateUrls` (defaults to empty) and `revision`. Matching URLs are only updated when explicitly listed; updates require the current revision or return HTTP 409. Imports and updates run in one SQLite transaction and preserve tile IDs and access-rule rows. Existing clients that omit `updateUrls` retain the previous insert-only behavior. Duplicate legacy saved URLs all receive the selected metadata update. `updated` is present when at least one unique URL is updated; `skipped` includes existing URLs, so the UI subtracts the updated URL count for its skipped summary.

## Operator recovery boundary

`server/state-backup.ts` is a command-line tool, not a web route. It uses the Node SQLite backup API, validates integrity and schema 4 or 5, and refuses existing backup files or populated restore directories. A recovered database includes accounts, tiles, groups, access rules, profiles, history, and configuration snapshots. All restored sessions are deleted so backup recovery cannot reactivate old browser sessions. Configuration snapshots in the administration UI still restore tiles/groups/rules only. Environment secrets and installed application files are backed up separately.

The native installer can adopt a pre-existing state directory into a new installation. It preserves the original directory, requires a supported runtime, rejects symlinks that escape the staged bundle, and verifies startup health. The systemd account writes only state; it cannot modify root-owned application files.

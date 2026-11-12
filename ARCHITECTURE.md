# Architecture and API

## Runtime and storage

The React interface is built with Vite and served by the Node.js process alongside the TypeScript API. Browser requests share one origin. The backend validates input with Zod and uses prepared statements with Node's built-in SQLite bindings.

SQLite uses WAL mode and transactional migrations tracked with `PRAGMA user_version`. The database stores accounts, session token digests, and application tiles. Tiles have a single category and a JSON array of tags. The migration to schema 3 adds an empty tag array to existing tiles. Version 1 JSON exports accept older entries without tags.

| Directory | Responsibility |
| --- | --- |
| `src/` | Sign-in, dashboard, editing, administration, and import review. |
| `server/` | Routing, authorization, SQLite, discovery, and Jellyfin. |
| `test/` | Automated API lifecycle and discovery scope tests. |
| `deploy/` | Native Ubuntu first-install script and systemd unit. |

## Authentication and authorization

First-run setup requires a deployment token and creates the administrator. Passwords are salted and hashed using scrypt. Session cookies use HttpOnly and SameSite=Strict, with Secure enabled for HTTPS origins. Session tokens expire after seven days and are stored as SHA-256 digests. Write requests require the configured Origin and the JSON content type. Setup and login share a process-wide throttle of 12 attempts per minute.

Administrators manage accounts and discovery. Editors manage tiles. Viewers and shared-password guests have read-only dashboard access. Removing an account revokes its sessions. Tile permissions apply to access within Nexus. Linked services enforce their own authentication.

## Discovery and integration

The administrator selects a server interface. The web discovery route combines mDNS advertisements with bounded HTTP and HTTPS checks of the selected IPv4 range, capped at a /24. It uses live page evidence first, then the port catalog for suggestions. Recognized unverified certificate names can provide a labeled clue. The browser previews results through the same validation and duplicate checks as a backup import.

Jellyfin receives read-only requests at the configured base URL. Nexus sends the aggregate active stream count to authenticated clients when a tile matches the base URL. The key is supplied through server configuration.

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
| `POST /api/admin/backup/preview` | Administrator | Validate a tile export and preview the available entries. |
| `POST /api/admin/backup/import` | Administrator | Merge selected tiles, skipping duplicate URLs. |

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

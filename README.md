# Nexus Dashboard

A native self-hosted launcher for homelab applications. This initial implementation includes token-gated administrator setup, sign-in, and a searchable dashboard with categorized application tiles.

## Local development

Install Node.js 24.14.1 or later in the 24.x series. Run `npm ci`, `npm run build`, and `npm test`. Set `NEXUS_SETUP_TOKEN` to a randomly generated secret of at least 32 characters, then run `npm start`. Open http://127.0.0.1:3000 and use that token to create the administrator. Rebuild after changes to the frontend.

## Ubuntu installation

See [native installation](docs/INSTALL.md) for the release layout, configuration, and first-run steps. [Architecture](ARCHITECTURE.md) describes the current implementation and [the roadmap](docs/DEVELOPMENT_STATUS.md) tracks open work.
See [the homelab port catalog](docs/HOMELAB_PORTS.md) for discovery defaults and [Jellyfin configuration](docs/INSTALL.md#jellyfin-activity) for live playback counts.

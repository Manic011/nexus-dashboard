# Native Ubuntu installation

Build and test on the workstation. Prepare a release containing the built `dist/`, `server/`, `package.json`, production `node_modules/`, the service file, and a verified official Node 24.x Linux runtime at `runtime/bin/node`. Test that exact release on Ubuntu before installing it. The deployment bundle is architecture-specific because it contains Node.

For an initial install, extract the release into a staging directory on the server. Check that port 3000, the `nexus-dashboard` account, service name and installation paths are available. From the staged release, an administrator can run `sudo bash deploy/install.sh "$PWD" "http://SERVER:3000"` with the actual browser origin. The installer generates a setup token and protects the environment file. Read the token at the server with `sudo sed -n 's/^NEXUS_SETUP_TOKEN=//p' /etc/nexus-dashboard/nexus.env`.

Sign in at the configured origin. Use HTTP only for the trusted integration network. For regular use with HTTPS, configure a reverse proxy, set `NEXUS_ORIGIN` to its HTTPS origin and `NEXUS_HOST=127.0.0.1`, then restart the service. Inspect status with `systemctl status nexus-dashboard` and logs with `journalctl -u nexus-dashboard`.

Before an upgrade, stop the service and back up the installation, protected config, and the full state directory. Stage and test the new release first. Start the upgraded service and check `/healthz`. Restore both the old artifacts and the matching state backup if a migration requires rollback.

## Jellyfin activity

Set NEXUS_JELLYFIN_URL to your Jellyfin base URL, including a reverse proxy subpath if applicable. Set NEXUS_JELLYFIN_API_KEY in the protected server environment file using a key from Jellyfin administration. Use a trusted HTTPS URL when available. Restart Nexus and add a tile with the same base URL. The tile shows the aggregate number of active streams. The key stays on the Nexus server and the integration only calls the configured Jellyfin endpoint. The service does not forward redirects. See [the Jellyfin Sessions API source](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/SessionController.cs).

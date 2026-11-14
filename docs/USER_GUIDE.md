# Nexus Dashboard user guide

## First sign-in

Open the exact URL configured by the operator. On a fresh instance, select a username, choose a password of 12 to 256 characters, and enter the setup token supplied by the operator. Keep the token in a private place during setup. Once the first administrator exists, Nexus shows the sign-in form.

## Add and organize applications

1. Select **Add tile** and enter a name and an HTTP or HTTPS URL. Include a custom port or path when the service needs one.
2. Choose an existing category from the dropdown or select **Create a category…** and enter its name. Categories group cards on the dashboard. Category filters and grouping are case-insensitive.
3. Optionally add a description and up to 12 comma-separated tags. Each tag can have up to 32 characters. Nexus treats tag names that differ only in capitalization as duplicates on a tile.
4. Select **Save tile**. The tile title opens the linked app in a new tab.

Select a tile's pencil button to edit it. Select its trash button and confirm to remove it from the dashboard. Use the search field to match names, descriptions, URLs, categories, and tags. Combine search with either filter, or click a tag on a card to filter by that tag. **Clear filters** returns to the complete dashboard.

## Discover and import services

1. Sign in as administrator and open **Administration → Discovery**.
2. Choose the server network and confirm permission to check the displayed range.
3. Select **Discover services**. The web check is limited to the selected local IPv4 range, capped at a /24. Allow up to about 90 seconds. If the time limit is reached, the status shows how many address and port combinations were checked.
4. Under **Review import**, select the entries you want. Use **Edit details** to revise a name, category, or tags before saving.
5. Select **Import selected**. Nexus skips URLs that are already saved and repeated URLs within the import.

Discovery checks mDNS advertisements and common HTTP and HTTPS ports. It can use application metadata, page titles, recognizable device pages, and some certificate names as clues. A certificate-based suggestion is labeled as unverified. Services on routed networks, uncommon ports, or behind hostname-based routing may need manual entry. Use **Add known service addresses** to paste one HTTP or HTTPS URL per line and review them before import. [Service port catalog](HOMELAB_PORTS.md)

## Manage access

| Role | Access |
| --- | --- |
| Administrator | Dashboard editing, discovery, backup import and export, account management, and system information. |
| Editor | Dashboard viewing and tile creation, editing, and deletion. |
| Viewer | Read-only dashboard access. |

In **Administration → Users**, enter a username, initial password, and role, then select **Create user**. To revoke an editor or viewer's access, select **Remove access** and confirm. Removal also ends that user's current sessions.

Enable a **shared dashboard password** in the same section to offer read-only access without distributing individual usernames. Guests select **Use shared dashboard password** on the sign-in screen. Removing the shared account revokes that access. Each linked service continues to enforce its own sign-in and permissions.

## Export and import a tile backup

In **Administration → Backup**, select **Download JSON**. The export contains tile names, descriptions, URLs, categories, and tags. Keep it private if the URLs expose details of your network.

To merge an export into the dashboard, use **Preview a backup**, select entries, and review the details before importing. Nexus accepts version 1 backups with up to 500 entries and a request limit of 2 MiB. A merge adds entries whose URLs are new. It leaves matching tiles in place. Use the Ubuntu state backup procedure for accounts, sessions, and the full SQLite database. [Backup and recovery](INSTALL.md#backup-upgrade-and-recovery)

## Jellyfin and system information

When the operator configures Jellyfin, a tile with the matching base URL displays the aggregate active stream count. **Jellyfin activity unavailable** means Nexus could not fetch a usable response. Administrators can view the Node.js version, platform, database schema version, and tile count under **Administration → System**. [Jellyfin setup](INSTALL.md#jellyfin-activity)

## Appearance preferences

Open **Appearance** in the header. Choose **System**, **Dark**, or **Light** for the theme, and **Comfortable** or **Compact** for card density. System follows your device's color scheme. Preferences are saved for your account in the current browser.

The tile editor lists existing categories and offers up to six reusable tags. Click a tag on a card to filter by it, or click it again to clear that filter. When an import preview opens, keyboard focus moves to **Review import**. On narrow screens, review entries scroll with the page.

## Administration history, permissions, and restore

**Discovery history** keeps the 20 most recent completed network scans. Select **Review results** to reopen a scan, edit entries in the import review, and import the URLs you select. Reviewing a scan does not start a new scan.

In **Users**, create a group and select its members. Under **Tile permissions**, select a tile and enable **Restrict access**. Administrators always have access. Other users need an individual grant or membership in an allowed group. Role restrictions still apply, so viewers cannot edit tiles. These controls govern Nexus visibility and do not change the linked application's sign-in.

In **Backup**, save a named snapshot to the server's SQLite state. Select **Review restore** beside a snapshot and confirm to replace the tile and group configuration. Nexus saves the current configuration automatically before restoring it, so you can return to either state. Snapshots include tiles, groups, and tile permissions. User accounts, passwords, and server settings require the full instance backup procedure. The JSON upload still previews a tile merge.

**System** shows host and kernel information, CPU, memory, process and host uptime, and the tile inventory. The inventory lists configured URLs and access scope.

During discovery, the progress bar counts completed checks. A Partial result shows how much of the range was checked. Review labels show where a suggested name came from, and existing URLs appear under Already on dashboard.

Review restore lists added, removed, and changed tiles, groups, and permissions. If the configuration changes while the preview is open, reopen the preview before restoring. The automatic snapshot includes the name of the restore target.

Open Preview effective access while editing tile permissions to see who can view or edit the tile and which individual or group grants apply to the current selections. Save permissions to apply the selections.

# StackJetty Dashboard user guide

## First sign-in

Open the exact URL configured by the operator. On a fresh instance, select a username, choose a password of 12 to 256 characters, and enter the setup token supplied by the operator. Keep the token in a private place during setup. Once the first administrator exists, StackJetty shows the sign-in form.

## Add and organize applications

1. Select **Add tile** and enter a name and an HTTP or HTTPS URL. Include a custom port or path when the service needs one.
2. Choose an existing category from the dropdown or select **Create a category…** and enter its name. Categories group cards on the dashboard. Category filters and grouping are case-insensitive.
3. Optionally add a description and up to 12 comma-separated tags. Each tag can have up to 32 characters. StackJetty treats tag names that differ only in capitalization as duplicates on a tile.
4. Select **Save tile**. The tile title opens the service using the tile’s opening mode or your default.

Select a tile's pencil button to edit it. Select its trash button and confirm to remove it from the dashboard. Use the search field to match names, descriptions, URLs, categories, and tags. Combine search with either filter, or click a tag on a card to filter by that tag. **Clear filters** returns to the complete dashboard.

## Customize the dashboard layout

1. Select **Customize layout** on the Applications page. The editor opens in your saved layout. In **Custom grid**, choose between one and six columns. Changing the column count repacks tiles in their current order.
2. Drag a tile to an empty cell, or select the tile and then select its destination. To swap two tiles, drop the first tile onto the second or select them in order. A move or swap needs enough space for both tile widths.
3. Select a tile to change its width. Use **Add row** to make more room, or leave cells empty to space out groups of tiles.
4. Choose **Preview layout** to hide the editing controls. Use **Back to editing** to keep arranging, **Save layout** to apply the draft, or **Cancel** to discard it.

In **Grouped by category**, grab the handle next to a category name and drop it above or below another section. The tiles move with their section. You can also focus the handle and press **Up** or **Down**, or use the buttons under **Category settings**. Select **Save layout** to keep your personal section order.

Drag a tile onto another tile in the same category, or select them in order to swap. Drop on a category heading, its divider line, or open space in the section to place the tile after the other tiles. Administrators and editors can move a tile to another section to change its category, including through **Move to category**. Saving a tile's category applies that change for everyone. **Cancel** discards the draft. With a tile selected in the grouped layout, choose **Standard** or **Full row** for its width.

The layout editor shows full cards, including categories, tags, descriptions and any service status. Use **Highlight category** and **Highlight tag** together to locate matching tiles while keeping every tile in its current position. The editor starts with any category or tag selected on the Applications page. **Arrange by category** starts each category on a fresh row and keeps the current tile widths and order within each category. You can adjust that draft before saving. On narrow screens the custom grid reflows just like the dashboard. Select a tile and use the **Row** and **Column** fields to place it in the full grid.

The custom grid can mix tiles from different categories. Select a category or tag on a tile to filter the dashboard. Search and filters show matching tiles in a compact grid in the saved order. Narrow screens also follow the saved order. New tiles are placed after the last saved tile. A change to a tile's destination URL gives it a fresh position.

Open **Category settings** to add labeled dividers to the custom grid, set personal display names, and move categories up or down. Drop on a divider with one category to place the tile in that category. A row with tiles from multiple categories shows each category name in its divider. Use **Move to category** to choose a category for a tile when a divider lists several. Category order applies to **Grouped by category** and to the next **Arrange by category** action. Display names appear in headings, category filters, and tile labels. Clear a display name to use the original category name.

Layout preferences are personal, including for viewers. They are saved for the signed-in account in the current browser profile and are cleared with other site data. Server backups do not carry them.

## Open a service and save its login

Under **Appearance → Open tiles by default**, choose **New browser tab**, **Embedded browser**, or **Kasm remote browser**. StackJetty saves this default for your signed-in account in the current browser. **Embedded browser** is the initial setting.

When adding or editing a tile, choose **Open this tile**. **Use my default** follows the viewer’s preference. An explicit choice is saved with the tile and applies to everyone who can see it. Kasm requires a configured provider and administrator access. If Kasm is unavailable, **Return to direct view** opens the embedded browser.

Select the tile title to open its service. Close the view or press **Escape** to return to your dashboard and filters. Your browser needs network access to the service URL. When the HTTPS dashboard opens an HTTP tile, select **Open in new tab**. For direct embedding, use the service’s HTTPS address or open StackJetty at its LAN HTTP address. Embedded services can use their own cookies and site storage, subject to your browser settings. If a service forbids framing, the service administrator must explicitly allow the StackJetty origin using that service’s supported configuration. Use **Page not displaying?** for checks you can make from the service view.

Open **Vault** in the header or **Saved login** in a service view to create your account's vault. Choose a master password of at least 16 characters. The same master password unlocks service logins and SSH passwords throughout StackJetty. Enter the service username and password under **Saved login**, then select **Save login**. Use **Copy username** or **Copy password** when signing in. Verify the service's address before pasting, especially if its login page redirected.

The vault stays unlocked while you move around StackJetty in the same tab. Use **Vault → Lock vault** to lock it everywhere in that tab. It also locks after two minutes, when you reload, or when you sign out. **Vault** lists saved destinations and lets you remove entries, including ones for deleted tiles or removed machines.

The vault requires a secure browser context, such as HTTPS or localhost, and an individual StackJetty account. It saves credentials for the exact destination in this browser profile. A new dashboard address, another device, or a different browser profile uses a different vault. Clearing site data removes the vault. StackJetty backups do not contain it, and there is no master-password recovery.

Administrators can select **Open in remote browser** when the operator has configured Kasm. The remote browser opens the saved service and streams it into the same StackJetty view. Sign in to Kasm and the service as needed. Use **Return to direct view** to switch back. End the remote session through Kasm when finished.

Under **Administration → Kasm**, set the provider's HTTPS address, enable the integration, and save. Set a default browser workspace for your account in Kasm. Try **Open Kasm Workspaces** to check the provider directly, or select a saved tile and choose **Test embedded launch**. Browser permissions for audio, clipboard, microphone, and camera are optional and start off.

Open **Password vault & Kasm help** below remote Chrome. Unlock your existing StackJetty vault on HTTPS or localhost, then copy the saved username or password for the selected tile. Paste each value into the corresponding field in remote Chrome. For direct paste, enable **Clipboard access** under **Administration → Kasm** and allow clipboard use in Kasm and your browser. You can also transfer text with **Clipboard** in the Kasm control panel when permitted. The panel also has a direct launch link for troubleshooting.

## Discover and import services

1. Sign in as administrator and open **Administration → Discovery**.
2. Choose the server network and optionally enter your own ranges, exclusions, or ports. The default scope uses the displayed local subnet, capped at a /24. See [Configure and run discovery](#configure-and-run-discovery) for routed private ranges.
3. Select **Review scan scope**, confirm permission for the resulting targets, then select **Discover services**. Larger scopes can take several minutes.
4. Under **Review import**, select the entries you want. Use **Edit details** to revise a name, category, or tags before saving.
5. Select **Import selected**. StackJetty skips URLs that are already saved and repeated URLs within the import.

Discovery checks mDNS advertisements and common HTTP and HTTPS ports. It can use application metadata, page titles, recognizable device pages, and some certificate names as clues. A certificate-based suggestion is labeled as unverified. Services on routed networks, uncommon ports, or behind hostname-based routing may need manual entry. Use **Add known service addresses** to paste one HTTP or HTTPS URL per line and review them before import. [Service port catalog](HOMELAB_PORTS.md)

## Manage access

| Role | Access |
| --- | --- |
| Primary administrator | The first setup account. It retains administrator access and can edit every account. Only this account can change its own details. |
| Administrator | Dashboard editing, discovery, backup import and export, account management, and system information. |
| Editor | Dashboard viewing and tile creation, editing, and deletion. |
| Viewer | Dashboard viewing and personal layout preferences. |

In **Administration → Users**, use **Add access** to enter a username, initial password, and role, then select **Create user**. The account list appears alongside the form on larger screens. To revoke an editor or viewer's access, select **Remove access** and confirm. Removal also ends that user's current sessions.

The account created during first-run setup is marked **Primary administrator**. It is protected from deletion and demotion. Existing installations retain their original setup account as the primary administrator.

Choose **Edit** beside an account to change its username or role, set a new or temporary password, or require a password change at the next sign-in. Administrators can manage other administrators, editors, and viewers. The primary administrator's edit action is available to that account alone. Administrators can remove other accounts, including administrators, while their own removal requires another administrator.

Every individual user can open **My account** in the header to edit their own username and password. Confirm your current password when editing your own account. Saving account changes ends that account's dashboard and SSH sessions. Sign in again with the updated details. Renaming keeps the account's ID, tile grants, group memberships, preferences, and encrypted browser vault.

When **Require password change at next sign-in** is enabled, the user signs in with their current or temporary password and must choose a different new password before accessing the dashboard. The password change screen requires the current password and matching confirmation. Shared dashboard passwords remain managed by administrators.

Enable a **shared dashboard password** in the same section to offer read-only access without distributing individual usernames. Guests select **Use shared dashboard password** on the sign-in screen. Removing the shared account revokes that access. Each linked service continues to enforce its own sign-in and permissions.

## Export and import a tile backup

In **Administration → Backup**, select **Download JSON**. The export contains tile names, descriptions, URLs, categories, and tags. Keep it private if the URLs expose details of your network.

To merge an export into the dashboard, use **Preview a backup**, select entries, and review the details before importing. StackJetty accepts version 1 backups with up to 500 entries and a request limit of 2 MiB. A merge selects new URLs by default. Existing URLs are unselected and marked **Update existing**. Selecting one explicitly replaces its name, category, description, and tags; its ID and permissions stay intact. A stale update preview is rejected if saved tiles have changed, so reopen the preview before retrying. Use the Ubuntu state backup procedure for accounts, sessions, and the full SQLite database. [Backup and recovery](INSTALL.md#backup-upgrade-and-recovery)

## Monitor services and connect to machines

Administrators can open **Diagnostics** from the main header for service availability, dashboard host metrics, and a browser-to-server network test. Select a service name or URL to follow that tile's opening preference. Use **Check services now** for a one-time check or **Enable monitoring** to collect uptime history. **Certificate unverified** means the endpoint answered but the dashboard server could not verify its HTTPS certificate.

For a local HTTPS service, expand **HTTPS certificate** on its uptime card, compare the fingerprint with the service's certificate, and select **Trust certificate for monitoring**. Run another service check to include its responses in availability. A changed certificate is flagged for review. Use **Remove certificate trust** to return that service to standard HTTPS verification.

Open **SSH machines** directly from the main header to connect and switch between sessions. Each has its own shell, statistics, and SFTP file manager. The dashboard signs out after 15 minutes of inactivity and closes all SSH sessions tied to that login. SSH requires operator enablement and HTTPS or a private localhost tunnel. [Diagnostics and SSH guide](DIAGNOSTICS.md)

Under **Add SSH machine → Discover**, scan your network and review the results. Edit names directly in the list and choose machines using their checkboxes. Under **For selected machines**, supply their shared SSH username and optional group, then select **Add selected machines**. You can save further selections from the same results with different usernames or groups. Hostname suggestions use network reverse DNS when available. Use **Enter manually** or a result's **Details** button for individual setup.

Unlock **Vault** and choose **Saved credential** to reuse a saved password during batch import. Its username fills in automatically and can be edited. The password is encrypted for each newly added machine and its observed SSH key. After verifying the host keys, use **Connect selected** to connect with those saved passwords.

## Jellyfin and system information

When the operator configures Jellyfin, a tile with the matching base URL displays the aggregate active stream count. **Jellyfin activity unavailable** means StackJetty could not fetch a usable response. Administrators can view the Node.js version, platform, database schema version, and tile count under **Administration → System**. [Jellyfin setup](INSTALL.md#jellyfin-activity)

## Appearance preferences

Open **Appearance** in the header. Choose **System**, **Dark**, or **Light** for the theme, and **Comfortable** or **Compact** for card density. System follows your device's color scheme. Preferences are saved for your account in the current browser.

The tile editor lists existing categories and offers up to six reusable tags. Click a tag on a card to filter by it, or click it again to clear that filter. When an import preview opens, keyboard focus moves to **Review import**. Results scroll within the review panel, with the selection count and save action below.

## Administration history, permissions, and restore

Administration uses four tabs. **Discovery** groups the server network, scan profile, address ranges, exclusions, and ports, then places import review before scan history. **Users** presents accounts, groups, and tile permissions in separate panels. **Backup** groups export and import controls above saved configurations. **System** groups application and host details above the tile inventory. Forms stack vertically on phones, and longer account, history, and inventory lists scroll within their panels.

**Discovery history** keeps the 20 most recent network scans, including stopped scans. Select **Review results** to reopen a scan, edit entries in the import review, and import the URLs you select. Reviewing a scan does not start a new scan.

If the server operator disables network discovery, use **Add known service addresses** or reopen a saved result. These options do not probe the network.

In **Users**, create a group and select its members. Under **Tile permissions**, select a tile and enable **Restrict access**. Administrators always have access. Other users need an individual grant or membership in an allowed group. Role restrictions still apply, so viewers cannot edit tiles. These controls govern StackJetty visibility and do not change the linked application's sign-in.

In **Backup**, save a named snapshot to the server's SQLite state. Select **Review restore** beside a snapshot and confirm to replace the tile and group configuration. StackJetty saves the current configuration automatically before restoring it, so you can return to either state. Snapshots include tiles, groups, and tile permissions. User accounts, passwords, and server settings require the full instance backup procedure. The JSON upload still previews a tile merge.

**System** shows host and kernel information, CPU, memory, process and host uptime, and the tile inventory. The inventory lists configured URLs and access scope.

During discovery, the progress bar counts completed checks. The result shows the number of address and port combinations checked. Review labels show where a suggested name came from, and existing URLs are marked Update existing and start unselected.

Review restore lists added, removed, and changed tiles, groups, and permissions. If the configuration changes while the preview is open, reopen the preview before restoring. The automatic snapshot includes the name of the restore target.

Open Preview effective access while editing tile permissions to see who can view or edit the tile and which individual or group grants apply to the current selections. Save permissions to apply the selections.

## Configure and run discovery

1. Open **Administration → Discovery** and choose **Server network**. This selects the server's source interface, not your workstation's interface. The blank address field defaults to the displayed /24 (or a narrower interface subnet).
2. Use **Add entry** within **IP addresses or ranges**, **Excluded IPs or ranges**, or **Ports or port ranges** to add separate rows. Remove a row with its labeled remove button. Each row accepts a typed value or a preset; comma-separated entries also work.
3. Addresses accept individual IPv4 addresses, inclusive ranges such as `10.42.0.10-10.42.0.20`, and CIDRs such as `192.168.1.0/24`. Multiple routed private subnets can be included in one scan. A bare `.0` address is one address, not a subnet: use `/24` for that subnet. CIDRs omit network and broadcast addresses except for /31 and /32. Exclusions use the same syntax. Duplicate targets are checked once.
4. Explicit targets outside the selected local subnet must be RFC 1918 private addresses: `10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`. Each scan accepts at most 4096 unique selected addresses before exclusions. Larger networks must be divided into smaller scans. Routing and firewalls determine reachability; StackJetty does not create routes or change firewalls. mDNS remains local to the source interface and does not discover advertisements across routed subnets.
5. Ports accept individual values and inclusive ranges from 1 through 65535. A blank field uses the common homelab catalog. Port presets include Standard web, Media servers, Proxmox, and Alternative web. A custom port list changes what is checked, not just the naming hints. Known secure ports use HTTPS; other custom ports use HTTP, so arbitrary HTTPS services on nonstandard ports are not guaranteed to be detected.
6. Select **Review scan scope** and check the deduplicated address, port, and total check counts. Confirm that you have permission to scan every target, then select **Discover services**. Editing the scope clears the authorization and requires another review.

There is no overall scan time limit. StackJetty uses 48 concurrent workers and bounded individual requests. A full 65535-port scan can take a long time. Keep the page open to follow progress; this preview does not reconnect to a scan after a page reload or resume scans after a service restart.

**Stop scan** stops scheduling new web probes. Current probes finish, and the short mDNS collection finishes, before the stopped result appears. You can review services found so far. A stopped scan is never a baseline for comparison. A failed probe or an unrecognized service does not prove the host is offline.

### Saved scan profiles

Enter a **Profile name** and select **Save profile** to store the source interface, address entries, exclusions, and port selection in the server's SQLite database. Saving the same name replaces its settings. Select a **Saved scan profile** to load it, review the scope, and authorize it again. Loading a profile never starts a scan. If the source interface no longer exists, select a current interface and review the targets again. Profiles are shared among administrators. Profile deletion, scheduling, and automatic scan execution are not implemented.

### Compare scans and review history

**Discovery history** retains the last 20 runs across service restarts. Select **Review results** to reopen an import review without probing the network again. Edits made in review are applied to tiles only when you select **Apply selected**; the historical scan itself stays unchanged.

When a complete scan has a previous complete scan of exactly the same source interface, effective addresses, and ports, **Changes since the previous complete scan of the same targets** lists added URLs, missing URLs, and URLs whose reported name or identification source changed. Missing means no response during that run, not confirmed downtime. Tiles are never removed automatically. Older scans without comparison metadata and runs exceeding the 500-result review limit cannot provide a complete comparison.

### Import or update services

The review identifies **New tile** and **Update existing** entries and shows evidence such as Web page, mDNS advertisement, TLS certificate (unverified), or Port match. Live page evidence takes priority over catalog guesses. A TLS certificate clue is labeled unverified; StackJetty does not disable certificate verification to fetch the application's HTTP content.

- **Filter results** searches names, URLs, categories, and identification sources. Original names remain searchable while you edit them so a rename does not hide the active row. Selections survive filtering; the action count includes selected rows hidden by the filter.
- **Select new** selects all new results across the entire review. Existing URLs remain unselected. **Clear selection** clears all entries.
- Select a result, expand **Edit details**, and adjust its name, category, tags, or description. The category dropdown includes saved categories and **Create a category...**. Names must be nonempty and at most 80 characters; categories at most 40; descriptions at most 180; tags at most 12, each at most 32 characters.
- **Apply selected (N)** creates new tiles and updates explicitly selected matching URLs. The operation is transactional. URLs are compared in normalized form, and duplicate entries are not inserted. Updating existing tiles preserves IDs and tile access rules. If legacy data contains several tiles for one normalized URL, all matching tiles receive the selected metadata update.
- Read the success message for imported, updated, and skipped counts. If saved tiles change after preview, refresh the review before updating existing entries. A JSON export remains compatible with older version 1 tile backups.

The review shows up to 500 services per run. Exported tile JSON contains tiles only; profiles, history, accounts, and sessions require a full database backup. Configuration snapshots contain tiles, groups, and tile permissions, but do not contain profiles or scan history.

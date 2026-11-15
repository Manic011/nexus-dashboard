# Diagnostics and SSH machines

Administrators can open **Diagnostics** or **SSH machines** from the main header. Editors and viewers cannot access these APIs.

See the [service diagnostics](screenshots/diagnostics.png) and [SSH file manager](screenshots/ssh-files.png) screenshots for examples with demo data.

## Service uptime

**Check services now** checks the first 500 saved services from the StackJetty server. **Enable monitoring** repeats the check every 60 seconds. **Pause monitoring** stops future scheduled checks. A check already in progress finishes normally.

Each check sends an HTTP HEAD request to the saved URL. If HEAD returns 405 or a 5xx error, StackJetty retries with GET and discards the response body. Redirects are recorded without following them. HTTP responses below 500 count as reachable, including sign-in responses such as 401 and 403. The monitor reports HTTP errors, timeouts, and connection failures separately. A reachable service may still have an application-level problem.

**Certificate unverified** means StackJetty reached the HTTPS endpoint but could not verify its certificate. These checks and older failures with an inconclusive cause are excluded from the availability percentage. If a private certificate authority signs your service certificates, configure the installed StackJetty runtime to trust that CA's public PEM certificate with `NODE_EXTRA_CA_CERTS`, then restart it. The URL hostname must still match the certificate. [Node.js certificate configuration](https://nodejs.org/download/release/v24.11.0/docs/api/cli.html#node_extra_ca_certsfile)

Each card shows the latest result and response time, sampled availability for 24 hours and seven days, the number of observations, and the last 30 checks. Automatic checks continue without an open browser while the StackJetty service runs. History is retained in the SQLite database for seven days and is included in full-database backups. Tile JSON exports and configuration snapshots do not include monitoring history.

Select a service name or URL to open it using the tile's saved mode, or your **Open tiles by default** preference when the tile uses your default. Embedded and Kasm views stay inside StackJetty. Closing the view returns focus to the service link.

Availability percentages cover recorded observations. StackJetty cannot reconstruct outages before monitoring began or while its own service was stopped. Changing a tile's URL starts a separate history for that destination. Checks run with up to six concurrent requests and a five-second request timeout. A large inventory can take longer than the sampling interval. StackJetty completes the current batch before starting another.

## Dashboard host

The host panel shows the operating system, kernel, architecture, CPU model and cores, memory, load averages, interface addresses, host uptime, and StackJetty uptime and memory. Data refreshes every five seconds. CPU utilization needs two observations before a percentage is available. A virtual machine or container may expose a limited CPU model or interface inventory.

## Network test

**Run network test** measures round-trip latency and transfers a 4 MiB download and upload between the current browser and StackJetty. It reports Mbps and includes application, proxy, tunnel, and browser overhead. This is a test of that connection. Repeat it from the browser and network location whose connection you want to measure.

Tests require an administrator session. The server limits transfer size and request frequency. A test transfers roughly 8 MiB plus protocol overhead.

## Enable SSH connections

SSH support is disabled by default. Set this in the protected server environment file and restart the service:

```ini
NEXUS_SSH=on
```

Use trusted HTTPS access or a localhost connection before entering SSH credentials. The SSH connector runs from the StackJetty server, so that server needs network access to the target SSH port. The machine's SSH service and authentication must already be configured.

### Private access through an SSH tunnel

From your workstation shell, use your existing trusted SSH configuration to forward a loopback port to StackJetty:

```sh
ssh -N -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -L 127.0.0.1:3443:127.0.0.1:3000 USER@SERVER
```

Open [http://127.0.0.1:3443](http://127.0.0.1:3443) in the workstation browser and sign in with your dashboard account. Keep the SSH connection running while using that address. The tunnel encrypts traffic between the workstation and Ubuntu. Browser access to loopback also makes Web Crypto available for password storage.

StackJetty accepts this alternate origin only for a direct loopback connection with a literal localhost Host header and no forwarding headers. Write requests must match that loopback origin exactly. Normal network access continues to use the configured origin.

### Register a machine

1. Open **SSH machines → Add SSH machine**.
2. Enter a display name, hostname or IP address, SSH port, and remote username.
3. Leave **Trusted host fingerprint** blank to review the key on first connection. If you already have a verified SHA256 fingerprint, paste it here to skip that review. For an OpenSSH server using an Ed25519 host key, get the fingerprint from the target's trusted console:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

4. Select **Save machine and continue**. If you're using plain LAN HTTP, choose **Save machine**, switch to HTTPS or the workstation tunnel, and select **Connect to**.
5. If you left the fingerprint blank, choose **Read server key**, check that it identifies your machine, and select **Trust key and continue**. StackJetty reads the key without sending credentials and remembers the accepted fingerprint. The key shown on first contact is supplied by the server and cannot establish its identity by itself. Compare it with the fingerprint from the machine's trusted console when the network or address is uncertain.
6. **Password** is selected by default. Enter the remote account's password and choose **Start SSH session**, or open **Saved SSH password** to save it in the browser vault. Choose **Private key** to use a session key and optional passphrase.

The host-key fingerprint must match the key negotiated for the connection. A mismatch rejects the connection. If the server presents another legitimate host-key algorithm, obtain that algorithm's fingerprint through a trusted channel before editing the saved fingerprint.

SSH password authentication supports the SSH password method and a single non-echo PAM password prompt. The fingerprint verifies server identity before authentication.

### Edit and organize saved machines

Use **Edit** on a machine to change its name, group, host, port, SSH username, or trusted fingerprint. **More** contains the removal action. Use **Search machines** to filter by name, address, port, username, or group. Machines without a group appear under **Ungrouped**.

Open **Organize machines** and choose individual rows or **Select visible**. Selections survive search changes and the count includes hidden rows. **Batch edit** updates the group, SSH username, or port for every selected machine. For a group change, leave **New group** empty to move the selection to **Ungrouped**.

Choose **Connect selected** with the vault unlocked to open one session per selected machine that has a trusted fingerprint and a matching saved password. Existing sessions stay open. Review the result for machines that need a host-key check, a password, or individual private-key authentication. **Disconnect selected** closes the open sessions for the selected machines in this workspace. The row's **Disconnect** closes all open sessions for that machine, and **Disconnect SSH** inside a session closes that session alone.

Edits to connection details close active sessions for the affected machine. Changing the address or port also clears its trusted host key. The vault associates passwords with the original connection details. After changing them, review the new destination and save its password if needed.

### Save an encrypted SSH password

Open **Saved SSH password** for a selected machine. Use the same account vault as your service logins. Once it is unlocked, enter **SSH password to save** and select **Save SSH password**. Use **Connect with saved password** to sign in while the vault is unlocked. You can lock it from the credential panel or **Vault** in the main header. It also locks after two minutes, when you reload, or when you sign out.

If you saved a password in an older machine vault, unlock your unified vault and choose **Import previous password** in that machine's **Saved SSH password** panel. Enter the master password you previously used for that machine. The old entry is removed after the import succeeds. If you no longer have the old master password, enter the machine's SSH password again and save it in the unified vault.

Each SSH entry is bound to the hostname, port, SSH username, and trusted host fingerprint. Passwords and private keys are used in server memory during authentication and the active connection. Optional saved passwords live as ciphertext in browser storage. Saved machine records and full-database backups carry host metadata, including hostnames and usernames. Use the same browser profile and dashboard address to unlock the vault. To remove a credential, choose **Remove saved password** or use **Vault** in the main header.

### Machine statistics

The statistics panel supports Linux hosts with procfs and standard utilities such as `uname`, `hostname`, `df`, and `ps`. It refreshes CPU utilization, memory and swap, load averages, uptime, filesystem usage, processes ordered by CPU, and aggregate interface traffic every five seconds. CPU and traffic rates need two samples. Commands run as the connected SSH user.

### File browser

**File browser** starts in the remote account's home directory. Use Back, Forward, Up, Refresh, or the path bar to navigate. Filter the current folder or sort by name, size, or modification time. Open a file by clicking its name to see a text preview of up to 128 KiB. Listings show up to 2,000 entries.

Select a row to use **New folder**, **Rename**, **Cut**, **Copy**, **Paste**, **Delete**, **Upload**, or **Download**. Cut moves the item when pasted. The clipboard belongs to that SSH session. Use Ctrl or Command with C, X, or V, F2 to rename, and Delete to open the confirmation. Deleting a folder permanently removes its contents after confirmation.

StackJetty uses SFTP and the remote account's filesystem permissions. Existing names are protected from overwrite. Folder copy and deletion are limited to 1,000 items and 32 levels. Copy is limited to 64 MiB. Browser uploads and downloads handle one regular file up to 4 MiB. Copy doesn't follow symbolic links. If a remote operation fails or is interrupted, refresh the folder to check which changes completed.

### Interactive shell

Open **Shell → Open interactive shell** to start an xterm-compatible terminal within StackJetty. Wait for **Shell ready** before typing. The shell supports interactive commands, control keys, and resizing. It executes commands with the remote account's permissions, including destructive commands that account is allowed to run.

The browser batches keystrokes and waits for output from the active shell as soon as it arrives. Input retains its order. Background shells continue running on their hosts and buffer output for when you return. The terminal indicates when older buffered output has been discarded. Shell commands and output are excluded from persistent application records.

Open another machine or connect again to the same machine. Switch between workspaces under **Open sessions**. Each workspace keeps its own terminal, folder, and clipboard when switching sessions or visiting other StackJetty pages. **Disconnect SSH** closes the selected session.

StackJetty signs out after 15 minutes without user interaction. Background metrics and terminal output do not extend the timer. Signing out closes all SSH sessions tied to that login, and the server closes them on expiration even if the browser disappears. Reloading or closing the page normally disconnects its sessions. Connections have a one-hour maximum lifetime and a server-wide limit of eight open or opening sessions. Separate dashboard logins cannot access each other's sessions.

## Troubleshooting

- **SSH disabled** — set `NEXUS_SSH=on` and restart the service.
- **HTTPS or localhost required** — open the trusted HTTPS address or use the workstation SSH tunnel above.
- **Host-key verification failed** — verify the machine address and trusted fingerprint through a separate trusted channel.
- **Authentication failed** — check the remote account, authentication method, key format, and passphrase. The connector supports SSH2 password authentication and private keys in formats accepted by ssh2.
- **Statistics unavailable** — check that the target runs Linux and exposes procfs and the required utilities. File browsing and the shell can still be used when their SSH subsystems are available.
- **Permission denied in files or shell** — use an account with the required remote permissions.
- **Shell closed or expired** — disconnect and start another SSH session.
- **Service unavailable but its tile opens** — check the server's route, DNS, certificate trust, and HTTP response. Browser reachability can differ from server reachability.

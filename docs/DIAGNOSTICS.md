# Diagnostics and SSH machines

Open **Diagnostics** in the main header as an administrator. The area has four sections. Editors and viewers cannot access these APIs.

## Service uptime

**Check services now** checks the first 500 saved services from the StackJetty server. **Enable monitoring** repeats the check every 60 seconds. **Pause monitoring** stops future scheduled checks. A check already in progress finishes normally.

Each check sends an HTTP HEAD request to the saved URL. If the service rejects HEAD with HTTP 405, StackJetty makes a GET request and discards the response body. Redirects are recorded without following them. HTTP responses below 500 count as reachable, including sign-in responses such as 401 and 403. HTTP 5xx responses, connection failures, timeouts, and certificate verification failures count as unavailable. A reachable service may still have an application-level problem.

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
3. Enter the trusted SHA256 host-key fingerprint. Obtain it from the target's trusted console or your administrator. For an OpenSSH server using an Ed25519 host key:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

4. Select **Save machine and continue**. StackJetty stores the machine details and opens the connection form. If you're using plain LAN HTTP, **Save machine** stores the details. Switch to HTTPS or the workstation tunnel and select **Connect to** to enter credentials.
5. **Password** is selected by default. Enter the remote account's password and choose **Start SSH session**, or open **Saved SSH password** to save it in the browser vault. Choose **Private key** to use a session key and optional passphrase.

The host-key fingerprint must match the key negotiated for the connection. A mismatch rejects the connection. If the server presents another legitimate host-key algorithm, obtain that algorithm's fingerprint through a trusted channel. Replace a saved entry when its host or trusted key changes.

SSH password authentication supports the SSH password method and a single non-echo PAM password prompt. The fingerprint verifies server identity before authentication.

### Save an encrypted SSH password

Open **Saved SSH password** for a selected machine. Create a vault with a master password of at least 16 characters, enter **SSH password to save**, and select **Save SSH password**. Later, unlock that vault and choose **Connect with saved password**. **Remove saved password** clears the entry, and **Lock vault** closes it immediately. The vault also locks after two minutes or when its panel closes.

Each saved machine has an encrypted vault scoped to your dashboard username in the current browser profile and origin. The vault uses AES-256-GCM with a random salt and fresh IV on every write. PBKDF2-SHA-256 derives the key from the master password using 600,000 iterations. Web Locks and a saved-ciphertext comparison protect concurrent writes. The master password stays in the browser. The encrypted entry is bound to the hostname, port, SSH username, and trusted host fingerprint.

Passwords and private keys are used in server memory during authentication and the active connection. Optional saved passwords live as ciphertext in browser storage. Saved machine records and full-database backups carry host metadata, including hostnames and usernames. Protect those backups. The password vault is browser-local, so use the same browser profile and dashboard address to unlock it. Clearing site data removes saved vaults. Keep the master password available because vault recovery is unavailable. Removing a saved machine clears its vault from the current browser.

### Machine statistics

The statistics panel supports Linux hosts with procfs and standard utilities such as `uname`, `hostname`, `df`, and `ps`. It refreshes CPU utilization, memory and swap, load averages, uptime, filesystem usage, processes ordered by CPU, and aggregate interface traffic every five seconds. CPU and traffic rates need two samples. Commands run as the connected SSH user.

### File browser

**File browser** starts in the remote account's home directory. Open a directory, follow a directory link, enter a **Remote path**, or use **Parent directory**. Listings show up to 2,000 entries. Select a regular file, or enter a file path and choose **Preview file**, to read up to 128 KiB as text. Binary files show a message. Access follows remote filesystem permissions.

### Interactive shell

Open **Shell → Open interactive shell** to start an xterm-compatible terminal within StackJetty. Wait for **Shell ready** before typing. The shell supports interactive commands, control keys, and resizing. It executes commands with the remote account's permissions, including destructive commands that account is allowed to run.

The browser uses authenticated same-origin requests to send input and poll output. Input is ordered and duplicate sequence numbers are ignored. Output is bounded, with a message when older buffered output has been discarded. Shell commands and output are excluded from persistent application records.

**Disconnect SSH**, signing out, leaving the SSH screen, or closing the page closes the connection. If the browser disappears without sending a disconnect request, the server reaps sessions after ten minutes without requests. Every connection has a one-hour maximum lifetime. The server permits eight open or opening SSH connections in total. A separate login session cannot access another session's connection.

## Troubleshooting

- **SSH disabled** — set `NEXUS_SSH=on` and restart the service.
- **HTTPS or localhost required** — open the trusted HTTPS address or use the workstation SSH tunnel above.
- **Host-key verification failed** — verify the machine address and trusted fingerprint through a separate trusted channel.
- **Authentication failed** — check the remote account, authentication method, key format, and passphrase. The connector supports SSH2 password authentication and private keys in formats accepted by ssh2.
- **Statistics unavailable** — check that the target runs Linux and exposes procfs and the required utilities. File browsing and the shell can still be used when their SSH subsystems are available.
- **Permission denied in files or shell** — use an account with the required remote permissions.
- **Shell closed or expired** — disconnect and start another SSH session.
- **Service unavailable but its tile opens** — check the server's route, DNS, certificate trust, and HTTP response. Browser reachability can differ from server reachability.

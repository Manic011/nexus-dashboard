# Local development

Use this guide to run StackJetty on your workstation for development or evaluation. For the managed systemd service, follow the [Ubuntu installation guide](INSTALL.md).

Install **Node.js 24.22.3 or newer in the 24.x series**. On GitHub, open the repository's **Code** menu to copy its clone URL, open it in GitHub Desktop, or download and extract a ZIP. Open a terminal in the project directory containing `package.json`. Use a Git checkout for contributions and for the release privacy check. [Node.js downloads](https://nodejs.org/en/download)

## Linux and macOS (Bash)

Run these commands in your workstation terminal:

```bash
npm ci && npm run build && npm test
```

When the checks pass, generate a first-run token and start StackJetty in the same terminal:

```bash
export NEXUS_SETUP_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
printf '%s\n' "$NEXUS_SETUP_TOKEN"
npm start
```

## Windows (PowerShell)

Run these commands in your Windows terminal. Use `npm.cmd` to invoke the Windows npm executable.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
```

When the checks pass, generate a first-run token and start StackJetty in the same terminal:

```powershell
$env:NEXUS_SETUP_TOKEN = node -p "require('node:crypto').randomBytes(32).toString('hex')"
$env:NEXUS_SETUP_TOKEN
npm.cmd start
```

## Open the dashboard

Visit [http://127.0.0.1:3000](http://127.0.0.1:3000). On first launch, enter the token printed in your terminal and create an administrator with a password of at least 12 characters. Later launches show the sign-in screen. StackJetty stores local state in `data/`. Press **Ctrl+C** in the terminal to stop it.

See the [contributing guide](../CONTRIBUTING.md) for the local development and remote verification workflow.

# StackJetty Dashboard

Develop and maintain Git locally. Build with `npm run build` and verify with `npm test`. Deploy only locally built artifacts to Ubuntu over verified SSH. Use Ubuntu for integration checks, preserve persistent state during deployments, and inspect service logs after deployment. Keep credentials, private deployment settings, and identifying host or network details out of Git and public artifacts.

Treat documentation updates as part of each feature change. Follow the [documentation checklist](CONTRIBUTING.md#documentation-checklist). Update the affected guides, changelog, and roadmap in the same change. Record what was actually verified on Ubuntu.

Review new and changed screens using the [UI audit](docs/UI_AUDIT.md). Extend browser coverage for new high-value flows.

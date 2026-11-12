# Contributing to Nexus Dashboard

Develop in the local Git checkout and use Ubuntu as the integration environment. Keep credentials, local databases, deployment settings, and preview data out of commits. The repository is private.

## Development workflow

1. Create a focused branch when a change benefits from separate review.
2. Use Node.js 24.14.1 or newer within the 24.x series. Run `npm ci` after checkout or a lockfile change.
3. Run `npm run build` to type-check and build the UI. Run `npm test` for the automated API and discovery scope tests.
4. For changes to a user workflow, integration, or deployment, exercise the normal entry point on Ubuntu. For schema changes, verify both a fresh database and an existing one.
5. Commit the code and documentation together. Push the branch and check the CI result. Describe any verification that still needs to happen in the pull request.

## Documentation checklist

Use this checklist when reviewing a feature, behavior change, or deployment change.

- [ ] Describe visible changes in [the changelog](CHANGELOG.md) under **Unreleased**.
- [ ] Update [the README](README.md) when a feature changes the project overview, quick start, or prerequisites.
- [ ] Update [the user guide](docs/USER_GUIDE.md) when screens, permissions, import formats, or workflows change. Match the UI's actual labels.
- [ ] Update [the install guide](docs/INSTALL.md) when runtime requirements, environment variables, storage, integrations, upgrades, or recovery procedures change.
- [ ] Update [the architecture and API reference](ARCHITECTURE.md) when endpoints, access rules, data storage, or service boundaries change.
- [ ] Update [the roadmap](docs/DEVELOPMENT_STATUS.md) and the [requirements audit](docs/REQUIREMENTS_AUDIT.md) when work moves from planned to implemented or when validation changes.

Check relative links and try changed commands in an appropriate environment. Keep examples generic, report verification accurately, and describe planned features as planned.

# UI audit

Review every new or changed screen before merging. Apply the same review to dialogs, menus, and admin sections.

- Check desktop and narrow mobile layouts, with long names, empty lists, and enough content to scroll.
- Check spacing, clipping, contrast in light and dark themes, and readability at browser zoom.
- Navigate with the keyboard. Verify visible focus, labels, dialog entry and return, Escape, and form submission.
- Check dropdown labels, default values, browser autofill, reusable tags, and category suggestions.
- Check loading, empty, success, and failure states. Confirm that rejected saves preserve the user's input.
- Exercise each affected role. Verify destructive actions require confirmation and access changes take effect.
- Check preference persistence and sign-out. Record any difference between device-local and account-wide settings.
- Add browser coverage for new high-value flows in `test/ui-audit.mjs`. Record manual checks and any remaining gaps in the pull request.

## Current coverage

The Chromium smoke test covers setup and sign-in, the dashboard, tile creation and editor focus, delete cancellation, tag filtering, persisted appearance settings, manual import review, backup download, system information, and viewer creation and removal. It checks horizontal overflow at 320 pixels. Real network scanning and assistive-technology review are separate manual checks.

Run from the repository root:

```sh
npm ci
npm run build
npx playwright-core install chromium --only-shell
npm run test:ui
```

On Linux CI, install the browser dependencies with the `--with-deps` option. The default test starts a local instance with a temporary database. For Ubuntu integration, set `NEXUS_UI_TEST_URL` and `NEXUS_UI_TEST_TOKEN` for a fresh disposable instance. The test creates accounts and tiles. [Playwright browser installation](https://playwright.dev/docs/browsers)

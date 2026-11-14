import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { createApp } from '../server/index.ts';

test('desktop and mobile UI flows', { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-ui-'));
  const token = 'fixture-setup-token';
  const password = 'fixture-password-123';
  const remote = process.env.NEXUS_UI_TEST_URL;
  const origin = remote ?? 'http://127.0.0.1:3419';
  const fixture = createServer((_req, res) => res.end(JSON.stringify([{ NowPlayingItem: { Id: 'test' } }, {}])));
  const app = remote ? undefined : createApp(directory, 'dist', origin, token, { baseUrl: 'http://127.0.0.1:3420', apiKey: 'fixture' });
  try {
    if (app) {
      fixture.listen(3420, '127.0.0.1');
      await once(fixture, 'listening');
      app.listen(3419, '127.0.0.1');
      await once(app, 'listening');
    }
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(7000);
      const button = name => page.getByRole('button', { name, exact: true });
      const field = name => page.getByLabel(name, { exact: true });
      async function fits(width, height) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      async function login(username, secret) {
        await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
        await field('Username').fill(username);
        await field('Password').fill(secret);
        await button('Sign in').click();
        await page.getByRole('heading', { name: 'Applications' }).waitFor().catch(async error => {
          throw new Error('Sign-in failed: ' + (await page.locator('main').innerText()), { cause: error });
        });
      }
      await page.goto(origin);
      await field('Username').fill('admin');
      await field('Password').fill(password);
      await field('Setup token').fill(process.env.NEXUS_UI_TEST_TOKEN ?? token);
      await button('Create account').click();
      await page.getByRole('heading', { name: 'No applications yet' }).waitFor();
      await button('Add tile').click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.ok(await dialog.getByLabel('Name', { exact: true }).evaluate(element => element === document.activeElement));
      await dialog.getByLabel('Name', { exact: true }).fill('Local tools');
      await field('URL').fill('https://user@example.net');
      await field('Category').selectOption({ label: 'Create a category…' });
      await field('New category').fill('Utilities');
      await dialog.locator('input[name=tags]').fill('lab, devices');
      await button('Save tile').click();
      await page.getByRole('alert').waitFor();
      assert.equal(await field('URL').evaluate(input => input.value), 'https://user@example.net');
      await field('URL').fill(remote ? origin : 'http://127.0.0.1:3420');
      await button('Save tile').click();
      await page.getByRole('link', { name: 'Local tools' }).waitFor();
      if (!remote || process.env.NEXUS_UI_TEST_JELLYFIN) await page.getByText('1 active stream', { exact: true }).waitFor();
      await button('Add tile').click();
      await dialog.getByLabel('Name', { exact: true }).fill('Other app');
      await field('URL').fill('https://example.com');
      await field('Category').selectOption({ label: 'Utilities' });
      await button('Save tile').click();
      await page.getByRole('link', { name: 'Other app' }).waitFor();
      await fits(320, 568);
      await button('Edit Local tools').click();
      assert.equal(await field('Category').locator('option:checked').textContent(), 'Utilities');
      await field('Category').selectOption({ label: 'Create a category…' });
      await field('New category').fill('Networking');
      await button('Save tile').click();
      await page.getByRole('heading', { name: /^Networking/ }).waitFor();
      await button('Edit Local tools').click();
      assert.equal(await field('Category').locator('option:checked').textContent(), 'Networking');
      assert.deepEqual(await field('Category').locator('option').allTextContents(), ['Networking', 'Utilities', 'Create a category…']);
      assert.equal(await dialog.locator('input[name=tags]').inputValue(), 'lab, devices');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(await button('Edit Local tools').evaluate(element => element === document.activeElement));
      await button('Delete Local tools').click();
      await page.keyboard.press('Escape');
      await page.getByRole('link', { name: 'Local tools' }).waitFor();
      if (!remote || process.env.NEXUS_UI_TEST_JELLYFIN) await page.getByText('1 active stream', { exact: true }).waitFor();
      await button('lab').click();
      assert.equal(await field('Filter by tag').inputValue(), 'lab');
      await button('lab').click();
      assert.equal(await field('Filter by tag').inputValue(), '');
      await page.getByText('Appearance', { exact: true }).click();
      await field('Theme').selectOption('light');
      await field('Card density').selectOption('compact');
      await page.reload();
      await page.locator('html[data-theme=light][data-density=compact]').waitFor();

      await button('Administration').click();
      await page.getByRole('heading', { name: 'Find services on your network' }).waitFor();
      assert.equal(await button('Discover services').isEnabled(), false);
      await page.getByText('Add known service addresses', { exact: true }).click();
      await field('Service addresses').fill('https://example.org/');
      await button('Preview addresses').click();
      const review = page.getByRole('region', { name: 'Review import' });
      await review.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-labelledby') === 'review-title');
      await review.getByText('Edit details').click();
      await review.getByLabel('Name', { exact: true }).fill('Imported app');
      await review.getByLabel('Category', { exact: true }).fill('Utilities');
      await button('Import selected (1)').click();
      await page.getByText(/Imported 1 tiles/).waitFor();
      await field('Service addresses').fill('https://example.org/');
      await button('Preview addresses').click();
      await review.getByText('Already on dashboard (1)').waitFor();
      const network = page.getByRole('combobox', { name: 'Server network' });
      if (await network.locator('option').count() > 1) {
        let releaseScan;
        const scanReady = new Promise(resolve => { releaseScan = resolve; });
        await page.route('**/api/admin/discovery/progress', route => route.fulfill({ json: { progress: { checked: 4, total: 10 } } }));
        await page.route('**/api/admin/discovery/web', async route => {
          await scanReady;
          await route.fulfill({ json: {
            version: 1, found: 1, checked: 4, total: 10,
            tiles: [{ title: 'Fixture service', url: 'https://fixture.example/', category: 'Utilities', description: '', source: 'Web page' }],
          } });
        });
        await network.selectOption({ index: 1 });
        await page.getByLabel('IP addresses or ranges preset').selectOption({ label: 'Nexus server only' });
        assert.ok(await page.getByLabel('IP addresses or ranges', { exact: true }).inputValue());
        await page.getByLabel('Excluded IPs or ranges preset').selectOption({ label: 'Exclude Nexus server' });
        assert.equal(await page.getByLabel('Excluded IPs or ranges', { exact: true }).inputValue(), await page.getByLabel('IP addresses or ranges', { exact: true }).inputValue());
        await page.getByLabel('Excluded IPs or ranges preset').selectOption({ label: 'No exclusions' });
        await page.getByLabel('Ports or port ranges preset').selectOption({ label: 'Standard web' });
        assert.equal(await page.getByLabel('Ports or port ranges', { exact: true }).inputValue(), '80, 443');
        await page.getByLabel('Ports or port ranges', { exact: true }).fill('80, 8000-8002');
        await button('Review scan scope').click();
        await page.getByText(/4 ports ·/).waitFor();
        await page.getByRole('checkbox', { name: /I have permission/ }).check();
        await button('Discover services').click();
        try { await page.getByText('4 / 10 checks', { exact: true }).waitFor(); }
        finally { releaseScan(); }
        await page.getByText(/Partial.*4 of 10/).waitFor();
        await review.getByText('Web page', { exact: true }).waitFor();
      }

      await button('Backup').click();
      const download = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Download JSON' }).click();
      assert.equal((await download).suggestedFilename(), 'nexus-dashboard.json');
      await button('System').click();
      await page.getByText('Database schema', { exact: true }).waitFor();
      await fits(320, 568);
      await button('Users').click();
      await field('Username').fill('reader');
      await field('Initial password').fill(password);
      await button('Create user').click();
      await page.getByText('User created.', { exact: true }).waitFor();
      await fits(320, 568);

      await field('Group name').fill('Lab team');
      await page.getByRole('group', { name: 'Members' }).getByLabel('reader').check();
      await button('Save group').click();
      await page.getByText('Group saved.', { exact: true }).waitFor();
      await field('Tile').selectOption({ label: 'Local tools · ' + (remote ? origin : 'http://127.0.0.1:3420') });
      await field('Restrict access').check();
      await button('Save permissions').click();
      await page.getByText('Tile permissions saved.', { exact: true }).waitFor();
      await button('Backup').click();
      await field('Snapshot name').fill('Restricted config');
      await button('Save snapshot').click();
      await page.getByText('Snapshot saved.', { exact: true }).waitFor();
      await button('Users').click();
      await field('Tile').selectOption({ label: 'Local tools · ' + (remote ? origin : 'http://127.0.0.1:3420') });
      await field('Restrict access').uncheck();
      await button('Save permissions').click();
      await page.getByText('Tile permissions saved.', { exact: true }).waitFor();
      await button('Backup').click();
      await button('Review restore').click();
      await page.getByText('Added · Local tools', { exact: true }).waitFor();
      await button('Restore configuration').click();
      await page.getByText('Before restoring Restricted config', { exact: true }).waitFor();
      await page.getByText(/Configuration restored/).waitFor();
      await button('Sign out').click();
      await login('reader', password);
      assert.equal(await page.getByRole('link', { name: 'Local tools' }).count(), 0);
      await page.getByRole('link', { name: 'Imported app' }).waitFor();
      assert.equal(await button('Add tile').count(), 0);
      assert.equal(await button('Administration').count(), 0);
      await button('Sign out').click();
      await login('admin', password);
      await button('Administration').click();
      await button('Users').click();
      await field('Tile').selectOption({ label: 'Local tools · ' + (remote ? origin : 'http://127.0.0.1:3420') });
      await page.getByRole('group', { name: 'Allowed users' }).getByLabel('reader').check();
      await page.getByText('Preview effective access', { exact: true }).click();
      await page.getByText('View · Individual grant', { exact: true }).waitFor();
      await button('Save permissions').click();
      await page.getByText('Tile permissions saved.', { exact: true }).waitFor();
      await button('Sign out').click();
      await login('reader', password);
      await page.getByRole('link', { name: 'Local tools' }).waitFor();
      await button('Sign out').click();
      await login('admin', password);
      await button('Administration').click();
      await button('Users').click();
      await button('Remove access for reader').click();
      await button('Cancel').click();
      await button('Remove access for reader').click();
      await button('Confirm removal').click();
      await page.getByText('Access removed.', { exact: true }).waitFor();
    } finally {
      await browser.close();
    }
  } finally {
    if (fixture.listening) fixture.close();
    if (app?.listening) {
      const closed = once(app, 'close');
      app.close();
      app.closeAllConnections();
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

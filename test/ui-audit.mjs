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
  const serviceFixture = process.env.NEXUS_UI_TEST_SERVICE ?? (remote ? undefined : 'http://127.0.0.1:3420');
  const fixture = createServer((req, res) => {
    if (req.url === '/Sessions') return res.end(JSON.stringify([{ NowPlayingItem: { Id: 'test' } }, {}]));
    res.setHeader('Content-Type', 'text/html');
    res.end('<script>localStorage.setItem("service-ready", "yes"); document.cookie = "fixture=ready";</script>' +
      '<script>if (document.cookie.includes("fixture=ready")) document.write("<h1>Fixture service</h1>");</script>');
  });
  const provider = 'https://browser.example.invalid/';
  const app = remote ? undefined : createApp(directory, 'dist', origin, token, { baseUrl: 'http://127.0.0.1:3420', apiKey: 'fixture' }, true, provider);
  try {
    if (app) {
      fixture.listen(3420, '127.0.0.1');
      await once(fixture, 'listening');
      app.listen(3419, '127.0.0.1');
      await once(app, 'listening');
    }
    const browser = await chromium.launch({ executablePath: process.env.NEXUS_UI_CHROMIUM_PATH });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(remote ? 15000 : 7000);
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
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: remote ? 30000 : 7000 });
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
      await field('URL').fill(serviceFixture ?? origin);
      await button('Save tile').click();
      await button('Local tools').waitFor();
      if (!remote || process.env.NEXUS_UI_TEST_JELLYFIN) await page.getByText('1 active stream', { exact: true }).waitFor();
      await button('Add tile').click();
      await dialog.getByLabel('Name', { exact: true }).fill('Other app');
      await field('URL').fill('https://example.com');
      await field('Category').selectOption({ label: 'Utilities' });
      await button('Save tile').click();
      await button('Other app').waitFor();
      await button('Customize layout').click();
      const board = page.getByRole('region', { name: 'Customize layout' });
      await field('Highlight category').selectOption('utilities');
      await field('Highlight tag').selectOption('lab');
      await board.getByText(/^1 of 2 tiles match/).waitFor();
      assert.equal(await board.getByRole('button', { name: /^Local tools, row/ }).getAttribute('data-match'), 'true');
      assert.equal(await board.getByRole('button', { name: /^Other app, row/ }).getAttribute('data-match'), 'false');
      await button('Clear highlights').click();
      await field('Columns').selectOption('3');
      await button('Add row').click();
      await board.getByRole('button', { name: /^Other app, row/ }).dragTo(button('Empty cell, row 3, column 2'));
      const moved = button('Other app, row 3, column 2');
      await moved.waitFor();
      await field('Width for Other app').selectOption('2');
      await board.getByText('Other app now spans 2 columns.').waitFor();
      await moved.press('Enter');
      await moved.press('Enter');
      await button('Empty cell, row 2, column 3').press('Enter');
      await board.getByText(/There is not enough room/).waitFor();
      await button('Empty cell, row 2, column 1').press('Enter');
      await button('Other app, row 2, column 1').waitFor();
      await button('Save layout').click();
      await page.getByText('Layout saved.', { exact: true }).waitFor();
      await page.reload();
      const customCard = page.locator('.app-tile').filter({ has: button('Other app') });
      await customCard.waitFor();
      assert.equal(await customCard.evaluate(card => getComputedStyle(card).gridRowStart), '2');
      assert.equal(await customCard.evaluate(card => getComputedStyle(card).gridColumnEnd), 'span 2');
      await customCard.getByRole('button', { name: 'Category: Utilities' }).click();
      assert.equal(await field('Filter by category').inputValue(), 'utilities');
      await customCard.getByRole('button', { name: 'Category: Utilities' }).click();
      await field('Search applications').fill('Other app');
      await button('Local tools').waitFor({ state: 'hidden' });
      assert.equal(await customCard.evaluate(card => getComputedStyle(card).gridRowStart), 'auto');
      await button('Clear filters').click();
      await fits(320, 568);
      assert.equal(await customCard.evaluate(card => getComputedStyle(card).gridRowStart), 'auto');
      await button('Customize layout').click();
      await fits(320, 568);
      await field('Layout').selectOption('categories');
      await board.getByRole('button', { name: 'Cancel' }).click();
      await page.locator('.custom-grid').waitFor();
      await button('Customize layout').click();
      await field('Layout').selectOption('categories');
      await button('Save layout').click();
      await page.locator('.group').waitFor();
      await fits(320, 568);
      if (serviceFixture) {
        const trigger = button('Local tools');
        await trigger.click();
        await dialog.waitFor();
        const frame = dialog.locator('iframe');
        assert.equal(await frame.getAttribute('src'), new URL(serviceFixture).href);
        assert.equal(await frame.getAttribute('sandbox'), 'allow-scripts allow-forms allow-same-origin');
        assert.equal(await page.evaluate(() => localStorage.getItem('service-ready')), null, 'Service storage remains isolated from StackJetty');
        assert.equal((await page.request.get(origin)).headers()['x-frame-options'], 'DENY');
        await frame.contentFrame().getByRole('heading', { name: 'Fixture service' }).waitFor();
        assert.equal(page.context().pages().length, 1);
        assert.equal(page.url(), origin + '/');
        if (!remote) {
          await page.route(provider, route => route.fulfill({ contentType: 'text/html', body: '<h1>Workspace session</h1>' }));
          await button('Open in remote browser').click();
          const workspace = dialog.frameLocator('iframe[title="Local tools remote browser"]');
          await workspace.getByRole('heading', { name: 'Workspace session' }).waitFor();
          assert.equal(page.context().pages().length, 1);
          assert.equal(page.url(), origin + '/');
          await button('Return to direct view').click();
          await frame.contentFrame().getByRole('heading', { name: 'Fixture service' }).waitFor();
        }
        await dialog.getByText('Saved login', { exact: true }).click();
        const master = 'fixture-vault-passphrase';
        const savedPassword = 'fixture-service-password';
        await field('Master password').fill(master);
        await field('Confirm master password').fill(master);
        await button('Create vault').click();
        await field('Service username').fill('fixture-user');
        await field('Service password').fill(savedPassword);
        await button('Save login').click();
        await dialog.getByText('Login saved.', { exact: true }).waitFor();
        const stored = await page.evaluate(() => localStorage.getItem('nexus.vault.v1:admin'));
        assert.ok(stored && !stored.includes(savedPassword) && !stored.includes(master) && !stored.includes('fixture-user'));
        assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await page.locator('iframe').count(), 0);
        assert.ok(await trigger.evaluate(element => element === document.activeElement));

        await page.reload();
        await trigger.click();
        await dialog.getByText('Saved login', { exact: true }).click();
        await field('Master password').fill('fixture-wrong-passphrase');
        await button('Unlock vault').click();
        await dialog.getByText('Unable to unlock the vault. Check your master password.').waitFor();
        await field('Master password').fill(master);
        await button('Unlock vault').click();
        assert.equal(await field('Service password').inputValue(), savedPassword);
        await button('Remove login').click();
        await dialog.getByText('Login removed.', { exact: true }).waitFor();
        await button('Close service view').click();
        await dialog.waitFor({ state: 'hidden' });
      }
      await button('Edit Local tools').click();
      assert.equal(await field('Category').locator('option:checked').textContent(), 'Utilities');
      await field('Category').selectOption({ label: 'Create a category…' });
      await field('New category').fill('Networking');
      await button('Save tile').click();
      await page.getByRole('heading', { name: /^Networking/ }).waitFor();
      await button('Customize layout').click();
      await button('Arrange by category').click();
      await board.getByRole('button', { name: 'Local tools, row 1, column 1' }).waitFor();
      await board.getByRole('button', { name: 'Other app, row 2, column 1' }).waitFor();
      await board.getByRole('button', { name: 'Cancel', exact: true }).click();
      await button('Edit Local tools').click();
      assert.equal(await field('Category').locator('option:checked').textContent(), 'Networking');
      assert.deepEqual(await field('Category').locator('option').allTextContents(), ['Networking', 'Utilities', 'Create a category…']);
      assert.equal(await dialog.locator('input[name=tags]').inputValue(), 'lab, devices');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(await button('Edit Local tools').evaluate(element => element === document.activeElement));
      await button('Delete Local tools').click();
      await page.keyboard.press('Escape');
      await button('Local tools').waitFor();
      if (!remote || process.env.NEXUS_UI_TEST_JELLYFIN) await page.getByText('1 active stream', { exact: true }).waitFor();
      await button('lab').click();
      assert.equal(await field('Filter by tag').inputValue(), 'lab');
      await button('lab').click();
      assert.equal(await field('Filter by tag').inputValue(), '');
      await page.getByText('Appearance', { exact: true }).click();
      await field('Theme').selectOption('light');
      await field('Card density').selectOption('compact');
      await field('Open tiles by default').selectOption('new-tab');
      await page.getByText('Appearance', { exact: true }).click();
      const externalTile = page.getByRole('link', { name: 'Local tools' });
      assert.equal(await externalTile.getAttribute('target'), '_blank');
      await button('Edit Local tools').click();
      await field('Open this tile').selectOption('embedded');
      await button('Save tile').click();
      await button('Local tools').waitFor();
      await page.reload();
      await page.locator('html[data-theme=light][data-density=compact]').waitFor();
      await button('Local tools').waitFor();
      await page.getByRole('link', { name: 'Other app' }).waitFor();
      await button('Edit Local tools').click();
      await field('Open this tile').selectOption('kasm');
      await button('Save tile').click();
      await dialog.waitFor({ state: 'hidden' });
      if (!remote) {
        await page.route(provider, route => route.fulfill({ contentType: 'text/html', body: '<h1>Workspace session</h1>' }));
        await button('Local tools').click();
        await dialog.frameLocator('iframe[title="Local tools remote browser"]').getByRole('heading', { name: 'Workspace session' }).waitFor();
        await button('Close service view').click();
      }
      await button('Edit Local tools').click();
      await field('Open this tile').selectOption('default');
      await button('Save tile').click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByText('Appearance', { exact: true }).click();
      await field('Open tiles by default').selectOption('embedded');
      await page.getByText('Appearance', { exact: true }).click();

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
      await review.getByLabel('Category', { exact: true }).selectOption('Utilities');
      await button('Apply selected (1)').click();
      await page.getByText(/Imported 1 tiles/).waitFor();
      await field('Service addresses').fill('https://example.org/');
      await button('Preview addresses').click();
      await review.getByText('Update existing', { exact: true }).waitFor();
      assert.equal(await button('Apply selected (0)').isEnabled(), false);
      await field('Filter results').fill('example.org');
      await review.getByRole('checkbox').check();
      await review.getByText('Edit details').click();
      await review.getByLabel('Name', { exact: true }).fill('Imported app');
      await review.getByLabel('Description', { exact: true }).fill('Updated through import review');
      await review.getByLabel('Category', { exact: true }).selectOption('Utilities');
      await button('Apply selected (1)').click();
      await page.getByText(/Updated 1 existing services/).waitFor();
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
        await page.getByLabel('IP addresses or ranges preset').selectOption({ label: 'StackJetty server only' });
        assert.ok(await page.getByLabel('IP addresses or ranges', { exact: true }).inputValue());
        await page.getByLabel('Excluded IPs or ranges preset').selectOption({ label: 'Exclude StackJetty server' });
        assert.equal(await page.getByLabel('Excluded IPs or ranges', { exact: true }).inputValue(), await page.getByLabel('IP addresses or ranges', { exact: true }).inputValue());
        await page.getByLabel('Excluded IPs or ranges preset').selectOption({ label: 'No exclusions' });
        await page.getByLabel('Ports or port ranges preset').selectOption({ label: 'Standard web' });
        assert.equal(await page.getByLabel('Ports or port ranges', { exact: true }).inputValue(), '80, 443');
        await page.getByLabel('Ports or port ranges', { exact: true }).fill('80');
        await button('Add entry for Ports or port ranges').click();
        await page.getByLabel('Ports or port ranges 2', { exact: true }).fill('8000-8002');
        await button('Add entry for IP addresses or ranges').click();
        await button('Remove IP addresses or ranges 2').click();
        await button('Add entry for Excluded IPs or ranges').click();
        await button('Remove Excluded IPs or ranges 2').click();
        await button('Review scan scope').click();
        await page.getByText(/4 ports/).waitFor().catch(async error => { throw new Error(await page.locator('main').innerText(), { cause: error }); });
        await field('Profile name').fill('UI test profile');
        await button('Save profile').click();
        await page.getByText(/Scan profile saved/).waitFor();
        await page.getByLabel('Saved scan profile').selectOption({ label: 'UI test profile' });
        await button('Review scan scope').click();
        await page.getByText(/4 ports/).waitFor();
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
      assert.equal((await download).suggestedFilename(), 'stackjetty.json');
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
      await field('Tile').selectOption({ label: 'Local tools · ' + (serviceFixture ?? origin) });
      await field('Restrict access').check();
      await button('Save permissions').click();
      await page.getByText('Tile permissions saved.', { exact: true }).waitFor();
      await button('Backup').click();
      await field('Snapshot name').fill('Restricted config');
      await button('Save snapshot').click();
      await page.getByText('Snapshot saved.', { exact: true }).waitFor();
      await button('Users').click();
      await field('Tile').selectOption({ label: 'Local tools · ' + (serviceFixture ?? origin) });
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
      assert.equal(await button('Local tools').count(), 0);
      await button('Imported app').waitFor();
      assert.equal(await button('Add tile').count(), 0);
      assert.equal(await button('Administration').count(), 0);
      await button('Customize layout').click();
      assert.equal(await page.getByRole('button', { name: /^Local tools, row/ }).count(), 0);
      await button('Save layout').click();
      await page.locator('.custom-grid').waitFor();
      await button('Sign out').click();
      await login('admin', password);
      await page.locator('.group').first().waitFor();
      await button('Administration').click();
      await button('Users').click();
      await field('Tile').selectOption({ label: 'Local tools · ' + (serviceFixture ?? origin) });
      await page.getByRole('group', { name: 'Allowed users' }).getByLabel('reader').check();
      await page.getByText('Preview effective access', { exact: true }).click();
      await page.getByText('View · Individual grant', { exact: true }).waitFor();
      await button('Save permissions').click();
      await page.getByText('Tile permissions saved.', { exact: true }).waitFor();
      await button('Sign out').click();
      await login('reader', password);
      await button('Local tools').waitFor();
      await page.locator('.custom-grid').waitFor();
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

test('administration keeps manual import available when discovery is disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-ui-restricted-'));
  const port = 3421;
  const origin = 'http://127.0.0.1:' + port;
  const token = 'fixture-setup-token';
  const app = createApp(directory, 'dist', origin, token, undefined, false);
  try {
    app.listen(port, '127.0.0.1');
    await once(app, 'listening');
    const setup = await fetch(origin + '/api/setup', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'fixture-password-123', token }),
    });
    assert.equal(setup.status, 200);
    const session = setup.headers.get('set-cookie').split(';')[0].split('=')[1];
    const browser = await chromium.launch({ executablePath: process.env.NEXUS_UI_CHROMIUM_PATH });
    try {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'nexus_session', value: session, url: origin }]);
      const page = await context.newPage();
      await page.goto(origin);
      await page.getByRole('button', { name: 'Administration', exact: true }).click();
      await page.getByText(/Network discovery is disabled on this server/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Discover services', exact: true }).count(), 0);
      await page.getByText('Add known service addresses', { exact: true }).click();
      await page.getByLabel('Service addresses').fill('https://service.example.invalid/');
      await page.getByRole('button', { name: 'Preview addresses', exact: true }).click();
      await page.getByRole('heading', { name: 'Review import' }).waitFor();
    } finally { await browser.close(); }
  } finally {
    if (app.listening) {
      const closed = once(app, 'close');
      app.close();
      app.closeAllConnections();
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

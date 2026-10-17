import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.RELAY_ARTIFACTS || 'artifacts/browser';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '4175' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', chunk => { serverLog += chunk; }); server.stderr.on('data', chunk => { serverLog += chunk; });
let browser;
const results = [];
const errors = [];
let page;
const step = async (name, fn) => {
  const start = Date.now();
  try { await fn(); results.push({ name, status: 'passed', ms: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'failed', ms: Date.now() - start, error: error.stack }); await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }); throw error; }
};
const dialog = () => page.locator('#modal');
const click = (name, opts = {}) => dialog().getByRole('button', { name, exact: true, ...opts }).click();
const actor = value => dialog().getByLabel('Task demo actor').selectOption(value);
const message = async text => { await page.locator('#message-input').fill(text); await page.getByRole('button', { name: 'Send local message' }).click(); };
const toast = () => page.locator('#toast').innerText();
const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem('relay-room-demo-v1')));
const open = async id => page.locator(`[data-action="task"][data-id="${id}"]`).first().click();
const close = async () => click('Close dialog');
let id;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    const ready = chunk => { if (String(chunk).includes('Relay demo:')) { clearTimeout(timer); resolve(); } };
    server.stdout.on('data', ready); server.once('error', reject); server.once('exit', code => { if (code) reject(new Error(`Server exited ${code}`)); });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, timezoneId: 'UTC', reducedMotion: 'reduce' });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4175');
  await step('desktop board renders eight tasks, four bots and explicit demo boundaries', async () => {
    await page.getByRole('heading', { name: 'Tasks', level: 1 }).waitFor();
    assert.equal(await page.locator('.task-card').count(), 8); assert.equal(await page.locator('.bot-card').count(), 4);
    assert.match(await page.locator('.demo-strip').innerText(), /no live agents or deployments/);
    await page.screenshot({ path: `${output}/desktop-board.png`, fullPage: true });
  });
  await step('search, owner filter, list view and empty result recovery work', async () => {
    await page.getByLabel('Search tasks').fill('NullPointerException'); assert.equal(await page.locator('.task-card').count(), 1);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByLabel('Filter by owner').selectOption('flux'); assert.equal(await page.locator('.task-row').count(), 2);
    await page.getByLabel('Search tasks').fill('nothing-like-this'); await page.getByRole('heading', { name: 'No matching tasks' }).waitFor();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
    await page.getByRole('button', { name: 'Board', exact: true }).click();
  });
  await step('new task validates, captures and edits structured metadata', async () => {
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await dialog().getByRole('textbox', { name: 'Title *', exact: true }).fill('Browser test example task');
    await dialog().getByLabel('Component / exclusive scope', { exact: false }).fill('BrowserExample.cls');
    await dialog().getByLabel('Description / expected behavior', { exact: false }).fill('A fictional record for the browser workflow.');
    await click('Create task'); id = (await snapshot()).tasks.at(-1).id;
    assert.equal((await snapshot()).tasks.at(-1).status, 'inbox');
    await click('Edit details'); await dialog().getByLabel('Source revision', { exact: false }).fill('browser-r2'); await click('Save details');
    assert.equal((await snapshot()).tasks.at(-1).revision, 'browser-r2'); await click('Mark ready');
  });
  await step('competing claim simulation admits only one owner and stale writes fail', async () => {
    await dialog().locator('summary').click(); await click('Simulate two claims');
    assert.match(await toast(), /Forge won. Flux was rejected: Stale task version/);
    assert.equal(await page.locator('#toast').evaluate(element => element.parentElement.id), 'modal');
    const before = (await snapshot()).tasks.at(-1).version;
    await dialog().locator('summary').click(); await click('Try stale update'); assert.match(await toast(), /Stale task version/);
    assert.equal((await snapshot()).tasks.at(-1).version, before);
  });
  await step('release, reclaim and reasoned handoff change the sole owner', async () => {
    await actor('forge'); await click('Release task'); await actor('flux'); await click('Claim task');
    await click('Hand off'); await dialog().getByLabel('New owner').selectOption('dot'); await dialog().getByLabel('Reason / handoff context').fill('Coordinate the synthetic next step'); await click('Save change');
    assert.equal((await snapshot()).tasks.at(-1).owner, 'dot');
  });
  await step('lease expiry and reclaim increment the fencing token', async () => {
    await actor('human'); const oldToken = (await snapshot()).tasks.at(-1).lease.token;
    await dialog().locator('summary').click(); await click('Simulate lease expiry');
    await actor('dot'); await click('Claim task'); assert.ok((await snapshot()).tasks.at(-1).lease.token > oldToken);
  });
  await step('missing test evidence blocks review; artifact and passing evidence unlock it', async () => {
    await click('Request review'); assert.match(await toast(), /changed artifact/);
    assert.equal(await page.locator('#toast').evaluate(element => element.parentElement.id), 'modal');
    await dialog().getByRole('tab', { name: /Changes & evidence/ }).click(); await click('Add artifact');
    await dialog().getByLabel('Relative artifact path', { exact: false }).fill('classes/BrowserExample.cls');
    await dialog().getByLabel('What changed', { exact: false }).fill('Add a synthetic empty-input guard'); await click('Save artifact');
    await dialog().getByRole('tab', { name: /Changes & evidence/ }).click(); await click('Record evidence');
    await dialog().getByLabel('Passed', { exact: false }).fill('7'); await dialog().getByLabel('Checks and outcome', { exact: false }).fill('Seven simulated example cases'); await click('Save evidence');
    await dialog().getByRole('tab', { name: 'Overview', exact: true }).click(); await click('Request review');
    assert.equal((await snapshot()).tasks.at(-1).status, 'review');
  });
  await step('same-author review and bot approval fail; independent review plus human approval finish without deployment', async () => {
    await click('Record independent review'); assert.match(await toast(), /different bot/);
    await actor('lens'); await click('Record independent review'); await click('Approve completion'); assert.match(await toast(), /human supervisor/);
    await actor('human'); await click('Approve completion');
    const task = (await snapshot()).tasks.at(-1); assert.equal(task.status, 'done'); assert.equal(task.deployment, 'not_deployed');
    await page.screenshot({ path: `${output}/task-approved.png`, fullPage: false });
  });
  await step('reopen invalidates reviews and preserves changed artifacts', async () => {
    await click('Reopen work'); await dialog().getByLabel('Reason / handoff context').fill('Another scenario needs attention'); await click('Save change');
    const task = (await snapshot()).tasks.at(-1); assert.equal(task.status, 'ready'); assert.equal(task.tests, null); assert.equal(task.reviewer, null); assert.equal(task.artifacts.length, 1);
  });
  await step('human ownership override requires a reason and has an audit event', async () => {
    await click('Human reassign'); await dialog().getByLabel('New owner').selectOption('flux'); await dialog().getByLabel('Reason / handoff context').fill('Give the UI engineer the next pass'); await click('Save change');
    assert.equal((await snapshot()).events.at(-1).kind, 'override'); assert.equal((await snapshot()).tasks.at(-1).owner, 'flux');
  });
  await step('task, general and direct messages stay scoped and HTML is rendered as text', async () => {
    await click('Open task room'); await message('Task-only note <img src=x onerror=alert(1)>');
    assert.equal(await page.locator('.message img').count(), 0); assert.match(await page.locator('.message-list').innerText(), /Task-only note/);
    await page.locator('[data-action="room"][data-channel="general"]').click(); assert.doesNotMatch(await page.locator('.message-list').innerText(), /Task-only note/);
    await message('General coordination note');
    await page.locator('.channel[data-channel="direct:lens"]').click(); await message('Direct reviewer note');
    assert.doesNotMatch(await page.locator('.message-list').innerText(), /General coordination note/);
    await page.screenshot({ path: `${output}/rooms.png`, fullPage: true });
  });
  await step('persistence survives reload and duplicate intake is rejected', async () => {
    await page.reload(); await page.getByRole('heading', { name: 'Tasks', level: 1 }).waitFor();
    assert.equal((await snapshot()).tasks.length, 9); assert.ok((await snapshot()).messages.some(m => m.text === 'Direct reviewer note'));
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await dialog().getByRole('textbox', { name: 'Title *', exact: true }).fill('Browser test example task'); await dialog().getByLabel('Component / exclusive scope', { exact: false }).fill('Other.cls'); await click('Create task');
    assert.match(await toast(), /Duplicate request/); assert.equal((await snapshot()).tasks.length, 9); await click('Cancel');
  });
  await step('keyboard tabs, modal containment and Escape dismissal work', async () => {
    await open(id); await dialog().getByRole('tab', { name: 'Overview', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await dialog().getByRole('tab', { name: /Changes & evidence/ }).getAttribute('aria-selected'), 'true');
    for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.querySelector('#modal').contains(document.activeElement)), true); }
    await page.keyboard.press('Escape'); assert.equal(await dialog().evaluate(element => element.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), id);
  });
  await step('cross-tab stale edit cannot overwrite a newer change', async () => {
    await open(id); await click('Edit details'); await dialog().getByRole('textbox', { name: 'Title *', exact: true }).fill('An old edit that must not win');
    const second = await context.newPage(); await second.goto('http://127.0.0.1:4175');
    await second.locator(`[data-action="task"][data-id="${id}"]`).first().click(); await second.locator('#modal').getByRole('button', { name: 'Edit details', exact: true }).click();
    await second.locator('#modal').getByRole('textbox', { name: 'Title *', exact: true }).fill('A newer saved title'); await second.locator('#modal').getByRole('button', { name: 'Save details', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('relay-room-demo-v1')).tasks.at(-1).title === 'A newer saved title');
    await click('Save details'); assert.match(await toast(), /Stale task version|Updated from another tab/); assert.equal((await snapshot()).tasks.at(-1).title, 'A newer saved title');
    await second.close(); await click('Cancel'); await close();
  });
  await step('mobile layout, accessible control names and dialog scrolling work', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload(); await page.getByRole('heading', { name: 'Tasks', level: 1 }).waitFor();
    for (const selector of ['#owner-filter', '#priority-filter', '#status-filter']) assert.ok(await page.locator(selector).evaluate(element => element.getBoundingClientRect().width >= 90));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const unnamed = await page.locator('button').evaluateAll(buttons => buttons.filter(button => !button.innerText.trim() && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby')).length); assert.equal(unnamed, 0);
    assert.equal(await page.locator('h1').count(), 1); assert.equal(await page.locator('main').count(), 1);
    await page.screenshot({ path: `${output}/mobile-board.png`, fullPage: true });
    await open('RLY-101'); assert.equal(await dialog().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await page.screenshot({ path: `${output}/mobile-task.png`, fullPage: false }); await close();
  });
  await step('storage failure preserves subsequent in-memory edits without reverting to older saved data', async () => {
    const seed = await snapshot();
    const offline = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
    await offline.addInitScript(value => {
      localStorage.setItem('relay-room-demo-v1', JSON.stringify(value));
      Storage.prototype.setItem = function () { throw new Error('Simulated quota error'); };
    }, seed);
    const isolated = await offline.newPage(); await isolated.goto('http://127.0.0.1:4175');
    for (const suffix of ['one', 'two']) {
      await isolated.getByRole('button', { name: 'New task', exact: true }).click();
      const form = isolated.locator('#modal');
      await form.getByRole('textbox', { name: 'Title *', exact: true }).fill(`Memory-only task ${suffix}`);
      await form.getByLabel('Component / exclusive scope', { exact: false }).fill(`MemoryOnly${suffix}.cls`);
      await form.getByRole('button', { name: 'Create task', exact: true }).click();
      await form.getByRole('button', { name: 'Close dialog', exact: true }).click();
    }
    assert.equal(await isolated.locator('.task-card').count(), seed.tasks.length + 2);
    assert.match(await isolated.locator('[role="alert"]').innerText(), /kept in this tab only/);
    await offline.close();
  });
  await step('reset requires confirmation and restores only the fictional seed', async () => {
    await page.setViewportSize({ width: 1440, height: 1080 }); await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
    await click('Keep my changes'); assert.equal((await snapshot()).tasks.length, 9);
    await page.getByRole('button', { name: 'Reset demo', exact: true }).click(); await click('Reset demo data');
    assert.equal((await snapshot()).tasks.length, 8); assert.equal((await snapshot()).messages.length, 4);
    assert.deepEqual(errors, []);
  });
  console.log(`RESULT ${results.length} passed, 0 failed, 0 skipped`);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, browserErrors: errors, serverLog }, null, 2) + '\n');
  if (browser) await browser.close(); server.kill('SIGTERM');
}

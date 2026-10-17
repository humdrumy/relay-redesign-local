import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.RELAY_SHARED_ARTIFACTS || 'artifacts/shared-browser'; await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(join(tmpdir(), 'relay-browser-db-')), origin = 'http://127.0.0.1:4176';
let server, serverLog = '', browser, page; const results = [], errors = [];
async function start() {
  server = spawn(process.execPath, ['server-shared.mjs'], { env: { ...process.env, PORT: '4176', RELAY_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', value => { serverLog += value; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Shared server startup timeout')), 10000);
    server.stdout.on('data', value => { serverLog += value; if (String(value).includes('Relay shared local test server')) { clearTimeout(timer); resolve(); } });
    server.once('error', reject); server.once('exit', code => { clearTimeout(timer); reject(new Error(`Shared server exited ${code}`)); });
  });
}
async function stop() { if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); }); }
const step = async (name, fn) => { const start = Date.now(); try { await fn(); results.push({ name, status: 'passed', ms: Date.now() - start }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, status: 'failed', error: error.stack }); await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }); throw error; } };
const view = () => page.evaluate(async () => (await fetch('/api/workspace')).json());
const mutation = async fn => { const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/command')), fn()]); return response; };
const close = () => page.getByRole('button', { name: 'Close dialog', exact: true }).click();
let taskId, marker;
try {
  await start(); browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce', timezoneId: 'UTC' }); page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin);
  await step('shared startup uses server state, locks actor identity and labels disconnected agents', async () => {
    await page.getByRole('heading', { name: 'Tasks', level: 1 }).waitFor();
    assert.match(await page.locator('.demo-strip').innerText(), /Private workspace/); assert.equal(await page.locator('#actor').isDisabled(), true);
    assert.equal(await page.locator('[data-action="reset"]').count(), 0); assert.equal(await page.locator('.task-card').count(), 8);
    assert.match(await page.locator('.bot-activity').first().innerText(), /test required/);
    assert.equal(await page.evaluate(() => localStorage.getItem('relay-room-demo-v1')), null);
    await page.screenshot({ path: `${output}/shared-board.png`, fullPage: true });
  });
  await step('human creates, edits and filters a durable inert task', async () => {
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title *', exact: true }).fill('Shared browser test task');
    await page.getByLabel('Component / exclusive scope', { exact: false }).fill('SharedTest.cls');
    assert.equal((await mutation(() => page.getByRole('button', { name: 'Create task', exact: true }).click())).status(), 200);
    await page.getByRole('heading', { name: 'Shared browser test task', exact: true }).waitFor(); taskId = (await view()).state.tasks.at(-1).id;
    await page.getByRole('button', { name: 'Edit details', exact: true }).click(); await page.getByLabel('Source revision', { exact: false }).fill('shared-r2');
    assert.equal((await mutation(() => page.getByRole('button', { name: 'Save details', exact: true }).click())).status(), 200);
    await page.getByRole('button', { name: 'Mark ready', exact: true }).waitFor(); await mutation(() => page.getByRole('button', { name: 'Mark ready', exact: true }).click());
    assert.equal((await view()).state.tasks.at(-1).revision, 'shared-r2'); await close();
    await page.getByLabel('Search tasks').fill('SharedTest.cls'); assert.equal(await page.locator('.task-card').count(), 1);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  });
  await step('room message is escaped, scoped, durable and readable through MCP', async () => {
    await page.locator('[data-channel="direct:dot"]').first().click(); marker = `Shared connection marker <script>alert(1)</script> ${Date.now()}`;
    await page.locator('#message-input').fill(marker); assert.equal((await mutation(() => page.getByRole('button', { name: 'Save room message' }).click())).status(), 200);
    await page.getByText(marker, { exact: true }).waitFor(); assert.equal(await page.locator('.message-list script').count(), 0);
    const response = await page.evaluate(async () => (await fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'relay_read_room', arguments: { room: 'direct:dot' } } }) })).json());
    assert.equal(response.result.structuredContent.messages.at(-1).text, marker); assert.equal(response.result.structuredContent.executionEnabled, false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/shared-room.png`, fullPage: true });
    await page.locator('[data-action="room"][data-channel="general"]').click(); assert.equal(await page.getByText(marker, { exact: true }).count(), 0);
  });
  await step('database survives a real server restart and browser reload', async () => {
    await stop(); await start(); await page.reload(); await page.getByRole('heading', { name: 'Tasks', level: 1 }).waitFor();
    assert.equal((await view()).state.tasks.at(-1).id, taskId);
    await page.locator('[data-channel="direct:dot"]').first().click(); await page.getByText(marker, { exact: true }).waitFor();
  });
  await step('network failure keeps message draft and retry does not duplicate it', async () => {
    await page.locator('#message-input').fill('Retained network-failure draft');
    await page.route('**/api/command', route => route.abort()); await page.getByRole('button', { name: 'Save room message' }).click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Your form has been kept'));
    assert.equal(await page.locator('#message-input').inputValue(), 'Retained network-failure draft');
    await page.unroute('**/api/command'); await mutation(() => page.getByRole('button', { name: 'Save room message' }).click());
    await page.getByText('Retained network-failure draft', { exact: true }).waitFor();
    assert.equal((await view()).state.messages.filter(item => item.text === 'Retained network-failure draft').length, 1);
  });
  await step('stale edit is rejected without losing input or overwriting newer work', async () => {
    await page.locator('button[data-action="page"][data-page="board"]').click(); await page.locator(`[data-action="task"][data-id="${taskId}"]`).first().click(); await page.getByRole('button', { name: 'Edit details', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title *', exact: true }).fill('Unsaved stale draft');
    const response = await page.evaluate(async id => { const view = await (await fetch('/api/workspace')).json(), task = view.state.tasks.find(item => item.id === id); return (await fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-client': '1' }, body: JSON.stringify({ operationId: crypto.randomUUID(), epoch: view.state.epoch, expectedVersion: task.version, command: { type: 'edit', taskId: id, input: { ...task, title: 'A newer saved title' } } }) })).status; }, taskId);
    assert.equal(response, 200); assert.equal((await mutation(() => page.getByRole('button', { name: 'Save details', exact: true }).click())).status(), 409);
    assert.equal(await page.getByRole('textbox', { name: 'Title *', exact: true }).inputValue(), 'Unsaved stale draft'); assert.equal((await view()).state.tasks.at(-1).title, 'A newer saved title');
    await close(); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await page.getByText('A newer saved title', { exact: true }).waitFor();
  });
  await step('human handoff offers stay pending, no agent identity or execution is fabricated', async () => {
    await page.locator(`[data-action="task"][data-id="${taskId}"]`).first().click();
    assert.equal(await page.getByRole('button', { name: 'Claim task', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Offer / revoke ownership', exact: true }).click(); await page.locator('select[name="target"]').selectOption('forge'); await page.getByLabel('Reason / handoff context', { exact: false }).fill('Pending engineer identity connection.');
    await mutation(() => page.getByRole('button', { name: 'Save change', exact: true }).click());
    await page.getByText(/Pending engineering handoff to Forge/).waitFor(); const state = await view();
    assert.equal(state.offers.at(-1).status, 'pending'); assert.equal(state.state.tasks.at(-1).owner, null); assert.equal(state.executionEnabled, false);
    await close();
  });
  await step('shared UI keyboard, responsive layout and zero JavaScript errors', async () => {
    await page.getByRole('button', { name: 'Workflow', exact: true }).first().click(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('#modal').contains(document.activeElement)), true); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-channel="direct:dot"]').first().click(); await page.getByText(marker, { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${output}/shared-narrow.png`, fullPage: true }); assert.deepEqual(errors, []);
  });
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors, serverLog }, null, 2)); await browser?.close(); await stop(); await rm(dataDir, { recursive: true, force: true });
}

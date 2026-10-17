import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workspaceFiles } from '../workspace-files.mjs';

test('workspace files appear on refresh without exposing generated folders or links', t => {
  const root = mkdtempSync(join(tmpdir(), 'relay-files-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'README.md'), 'Hello');
  writeFileSync(join(root, 'node_modules', 'private.js'), 'hidden');
  assert.deepEqual(workspaceFiles(root).files.map(file => file.path), ['README.md']);
  writeFileSync(join(root, 'src', 'new.js'), 'export {}');
  assert.deepEqual(workspaceFiles(root).files.map(file => file.path), ['README.md', 'src/new.js']);
  try { symlinkSync(join(root, 'README.md'), join(root, 'link.md')); }
  catch { return; } // Symlink creation may be restricted on Windows.
  assert.equal(workspaceFiles(root).files.some(file => file.path === 'link.md'), false);
});

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ignored = new Set(['node_modules', 'dist', 'dist-shared', 'build', 'coverage']);

export function workspaceFiles(root, limit = 1000) {
  const files = [], directories = [];
  let truncated = false;
  function visit(directory, prefix = '', depth = 0) {
    if (depth > 12 || files.length + directories.length >= limit) { truncated = true; return; }
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      if (files.length + directories.length >= limit) { truncated = true; break; }
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        directories.push(path);
        visit(join(directory, entry.name), path, depth + 1);
      } else if (entry.isFile()) {
        try { files.push({ path, size: statSync(join(directory, entry.name)).size }); }
        catch { /* File changed during the scan; it will appear on refresh. */ }
      }
    }
  }
  visit(root);
  return { files, directories, truncated };
}

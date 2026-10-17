import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
export async function applyMigrations(db) {
  // Development-only ledger. Hosted D1 schema migrations are applied by Sites before upload.
  db.exec('CREATE TABLE IF NOT EXISTS relay_local_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
  for (const name of readdirSync('drizzle').filter(value => value.endsWith('.sql')).sort()) {
    const sql = readFileSync(`drizzle/${name}`, 'utf8'), hash = createHash('sha256').update(sql).digest('hex');
    const previous = await db.prepare('SELECT hash FROM relay_local_migrations WHERE name = ?').bind(name).first();
    if (previous) { if (previous.hash !== hash) throw new Error('Applied migration changed: ' + name); continue; }
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(sql); await db.prepare('INSERT INTO relay_local_migrations (name, hash) VALUES (?, ?)').bind(name, hash).run(); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}

import { DatabaseSync } from 'node:sqlite';
export function openSqlite(filename) {
  const connection = new DatabaseSync(filename);
  connection.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  return {
    exec: sql => connection.exec(sql), close: () => connection.close(),
    async batch(statements) {
      connection.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(statement => statement._execute()); connection.exec('COMMIT'); return results; }
      catch (error) { connection.exec('ROLLBACK'); throw error; }
    },
    prepare(sql) {
      const statement = connection.prepare(sql);
      return { bind(...values) { return {
        async first() { return statement.get(...values) ?? null; },
        async all() { return { results: statement.all(...values) }; },
        _execute() { if (statement.columns().length) return { results: statement.all(...values), meta: { changes: 0 } }; const result = statement.run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
        async run() { const result = statement.run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
      }; } };
    },
  };
}

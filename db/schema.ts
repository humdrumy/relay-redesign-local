import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const relayWorkspaces = sqliteTable('relay_workspaces', {
  id: text('id').primaryKey().notNull(),
  ownerId: text('owner_id').notNull(),
  version: integer('version').notNull(),
  body: text('body').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
// Separate, additive control-room records preserve the original workspace verbatim.
export const relayControlMeta = sqliteTable('relay_control_meta', {
  id: text('id').primaryKey().notNull(), ownerId: text('owner_id').notNull(),
  epoch: text('epoch').notNull(), revision: integer('revision').notNull(),
  commitId: text('commit_id').notNull(), createdAt: integer('created_at').notNull(),
});
export const relayControlRecords = sqliteTable('relay_control_records', {
  kind: text('kind').notNull(), id: text('id').notNull(), body: text('body').notNull(),
}, table => [primaryKey({ columns: [table.kind, table.id] }), index('relay_control_kind').on(table.kind)]);
